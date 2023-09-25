import { Interface } from '@ethersproject/abi';
import { BasePool } from '../balancer-v2-pool';
import { SwapSide } from '../../../../constants';
import { callData, SubgraphPoolBase, PoolState, TokenState } from '../../types';
import { BigNumber as OldBigNumber, bnum } from './utils/bignumber';
import { BigNumber, parseFixed } from '@ethersproject/bignumber';
import { decodeThrowError, getTokenScalingFactor } from '../../utils';
import { parseFixedCurveParam } from './utils/parseFixedCurveParam';
import {
  ONE_36,
  exactTokenInForTokenOut,
  tokenInForExactTokenOut,
  poolBalancesToNumeraire,
  viewRawAmount,
} from './FXPoolMath';
import { safeParseFixed } from './utils/utils';
import { BI_POWS } from '../../../../bigint-constants';

/**
 * =========================
 * Enums
 * =========================
 */

export type FXPoolPairData = {
  tokenIn: string;
  tokenOut: string;
  decimalsIn: number;
  decimalsOut: number;
  balanceIn: BigNumber;
  balanceOut: BigNumber;
  alpha: OldBigNumber;
  beta: OldBigNumber;
  lambda: OldBigNumber;
  delta: OldBigNumber;
  epsilon: OldBigNumber;
  tokenInLatestFXPrice: BigNumber;
  tokenOutLatestFXPrice: BigNumber;
  tokenInFXOracleDecimals: number;
  tokenOutFXOracleDecimals: number;
};

/**
 * =========================
 * Main class
 * =========================
 */

export class FXPool extends BasePool {
  vaultAddress: string;
  vaultInterface: Interface;

  constructor(vaultAddress: string, vaultInterface: Interface) {
    super();
    this.vaultAddress = vaultAddress;
    this.vaultInterface = vaultInterface;
  }

  // targetSwap
  onBuy(tokenAmountsOut: bigint[], poolPairData: FXPoolPairData): bigint[] {
    try {
      return tokenAmountsOut.map(amount => {
        const amountStr = (
          amount / BI_POWS[poolPairData.decimalsIn]
        ).toString();
        return this._inHigherPrecision(
          tokenInForExactTokenOut,
          bnum(amountStr),
          poolPairData,
        );
      });
    } catch (e) {
      return tokenAmountsOut.map(() => 0n);
    }
  }

  // originSwap
  onSell(amounts: bigint[], poolPairData: FXPoolPairData): bigint[] {
    try {
      return amounts.map(amount => {
        const amountStr = (
          amount / BI_POWS[poolPairData.decimalsIn]
        ).toString();
        return this._inHigherPrecision(
          exactTokenInForTokenOut,
          bnum(amountStr),
          poolPairData,
        );
      });
    } catch (e) {
      return amounts.map(() => 0n);
    }
  }

  /*
  Helper function to parse pool data into params for onSell/onBuy functions.
  */
  parsePoolPairData(
    pool: SubgraphPoolBase,
    poolState: PoolState,
    tokenIn: string,
    tokenOut: string,
  ): FXPoolPairData {
    let indexIn = 0;
    let indexOut = 0;
    const balances: bigint[] = [];
    const decimals: number[] = [];

    const tokens = poolState.orderedTokens.map((tokenAddress, i) => {
      const t = pool.tokensMap[tokenAddress.toLowerCase()];
      if (t.address.toLowerCase() === tokenIn.toLowerCase()) indexIn = i;
      if (t.address.toLowerCase() === tokenOut.toLowerCase()) indexOut = i;

      balances.push(poolState.tokens[t.address.toLowerCase()].balance);
      decimals.push(t.decimals);

      return t.address;
    });

    const tokenInLatestFXPrice = pool.tokens[indexIn].token?.latestFXPrice;
    const tokenOutLatestFXPrice = pool.tokens[indexOut].token?.latestFXPrice;
    if (!tokenInLatestFXPrice || !tokenOutLatestFXPrice)
      throw 'FXPool Missing LatestFxPrice';

    let tokenInFXOracleDecimals = pool.tokens[indexIn].token?.fxOracleDecimals;
    if (!tokenInFXOracleDecimals) tokenInFXOracleDecimals = 8;
    let tokenOutFXOracleDecimals = pool.tokens[indexIn].token?.fxOracleDecimals;
    if (!tokenOutFXOracleDecimals) tokenOutFXOracleDecimals = 8;

    const balanceIn = BigNumber.from(balances[indexIn].toString());
    const balanceOut = BigNumber.from(balances[indexOut].toString());

    const poolPairData: FXPoolPairData = {
      tokenIn: tokens[indexIn],
      tokenOut: tokens[indexOut],
      decimalsIn: decimals[indexIn],
      decimalsOut: decimals[indexOut],
      balanceIn,
      balanceOut,
      alpha: parseFixedCurveParam(pool.alpha),
      beta: parseFixedCurveParam(pool.beta),
      lambda: parseFixedCurveParam(pool.lambda),
      delta: bnum(parseFixed(pool.delta, 18).toString()),
      epsilon: parseFixedCurveParam(pool.epsilon),
      tokenInLatestFXPrice: parseFixed(
        tokenInLatestFXPrice,
        tokenInFXOracleDecimals,
      ),
      tokenOutLatestFXPrice: parseFixed(
        tokenOutLatestFXPrice,
        tokenOutFXOracleDecimals,
      ),
      tokenInFXOracleDecimals,
      tokenOutFXOracleDecimals,
    };

    return poolPairData;
  }

  /*
  Helper function to construct onchain multicall data for StablePool.
  */
  getOnChainCalls(pool: SubgraphPoolBase): callData[] {
    const poolCallData: callData[] = [
      {
        target: this.vaultAddress,
        callData: this.vaultInterface.encodeFunctionData('getPoolTokens', [
          pool.id,
        ]),
      },
    ];
    return poolCallData;
  }

  /*
  Helper function to decodes multicall data for a Stable Pool.
  data must contain returnData
  startIndex is where to start in returnData. Allows this decode function to be called along with other pool types.
  */
  decodeOnChainCalls(
    pool: SubgraphPoolBase,
    data: { success: boolean; returnData: any }[],
    startIndex: number,
  ): [{ [address: string]: PoolState }, number] {
    const pools = {} as { [address: string]: PoolState };

    const poolTokens = decodeThrowError(
      this.vaultInterface,
      'getPoolTokens',
      data[startIndex++],
      pool.address,
    );

    const poolState: PoolState = {
      swapFee: 0n,
      orderedTokens: poolTokens.tokens,
      tokens: poolTokens.tokens.reduce(
        (ptAcc: { [address: string]: TokenState }, pt: string, j: number) => {
          const tokenState: TokenState = {
            balance: BigInt(poolTokens.balances[j].toString()),
          };
          ptAcc[pt.toLowerCase()] = tokenState;
          return ptAcc;
        },
        {},
      ),
    };

    pools[pool.address] = poolState;

    return [pools, startIndex];
  }

  /*
    Fx pool logic has an alpha region where it halts swaps.
    maxLimit  = [(1 + alpha) * oGLiq * 0.5] - token value in numeraire
    */
  getSwapMaxAmount(poolPairData: FXPoolPairData, side: SwapSide): bigint {
    return this._inHigherPrecision(this._getSwapMaxAmount, poolPairData, side);
  }

  /**
   * =========================
   * Class private functions
   * =========================
   */

  _getSwapMaxAmount(poolPairData: FXPoolPairData, side: SwapSide): bigint {
    try {
      const parsedReserves = poolBalancesToNumeraire(poolPairData);

      const alphaValue = safeParseFixed(poolPairData.alpha.toString(), 18);

      const maxLimit = alphaValue
        .add(ONE_36)
        .mul(parsedReserves._oGLiq_36)
        .div(ONE_36)
        .div(2);

      if (side === SwapSide.SELL) {
        const maxLimitAmount_36 = maxLimit.sub(
          parsedReserves.tokenInReservesInNumeraire_36.toString(),
        );

        return BigInt(
          viewRawAmount(
            maxLimitAmount_36,
            poolPairData.decimalsIn,
            poolPairData.tokenInLatestFXPrice,
            poolPairData.tokenInFXOracleDecimals,
          ).toString(),
        );
      } else {
        const maxLimitAmount_36 = maxLimit.sub(
          parsedReserves.tokenOutReservesInNumeraire_36,
        );

        return BigInt(
          viewRawAmount(
            maxLimitAmount_36,
            poolPairData.decimalsOut,
            poolPairData.tokenOutLatestFXPrice,
            poolPairData.tokenOutFXOracleDecimals,
          ).toString(),
        );
      }
    } catch {
      return 0n;
    }
  }

  /**
   * =========================
   * Class util functions
   * =========================
   */

  /**
   * Runs the given function with the BigNumber config set to 36 decimals.
   * This is needed since in the Solidity code we use 64.64 fixed point numbers
   * for the curve math operations (ABDKMath64x64.sol). This makes the SOR
   * default of 18 decimals not enough.
   *
   * @param funcName
   * @param args
   * @returns
   */
  _inHigherPrecision(funcName: Function, ...args: any[]): bigint {
    const prevDecimalPlaces = OldBigNumber.config({}).DECIMAL_PLACES;
    OldBigNumber.config({
      DECIMAL_PLACES: 36,
    });

    try {
      const val = funcName.apply(this, args);
      OldBigNumber.config({
        DECIMAL_PLACES: prevDecimalPlaces,
      });
      return BigInt(val.toString());
    } catch (err: any) {
      // restore the original BigNumber config even in case of an exception
      OldBigNumber.config({
        DECIMAL_PLACES: prevDecimalPlaces,
      });
      throw err;
    }
  }
}
