import { Interface } from '@ethersproject/abi';
import { BaseGeneralPool } from '../balancer-v2-pool';
import { SwapSide } from '../../../../constants';
import { callData, SubgraphPoolBase, PoolState } from '../../types';
import { BigNumber } from '@ethersproject/bignumber';
import { safeParseFixed } from '../../utils';

export type FxPoolPairData = {
  tokens: string[];
  balances: bigint[];
  indexIn: number;
  indexOut: number;
  scalingFactors: bigint[];
  alpha: BigNumber;
  beta: BigNumber;
  lambda: BigNumber;
  delta: BigNumber;
  epsilon: BigNumber;
  tokenInLatestFXPrice: BigNumber;
  tokenOutLatestFXPrice: BigNumber;
};

export class FXPool extends BaseGeneralPool {
  vaultAddress: string;
  vaultInterface: Interface;

  constructor(vaultAddress: string, vaultInterface: Interface) {
    super();
    this.vaultAddress = vaultAddress;
    this.vaultInterface = vaultInterface;
  }

  _onSwapGivenIn(
    tokenAmountsIn: bigint[],
    balances: bigint[],
    indexIn: number,
    indexOut: number,
    _amplificationParameter: bigint,
  ): bigint[] {
    const amountsOut: bigint[] = [];
    return amountsOut;
  }

  _onSwapGivenOut(
    tokenAmountsOut: bigint[],
    balances: bigint[],
    indexIn: number,
    indexOut: number,
    _amplificationParameter: bigint,
  ): bigint[] {
    const amountsIn: bigint[] = [];
    return amountsIn;
  }

  /*
  Helper function to parse pool data into params for onSell/onBuy functions.
  */
  parsePoolPairData(
    pool: SubgraphPoolBase,
    poolState: PoolState,
    tokenIn: string,
    tokenOut: string,
  ): FxPoolPairData {
    let indexIn = 0;
    let indexOut = 0;
    const balances: bigint[] = [];
    const scalingFactors: bigint[] = [];

    const tokens = poolState.orderedTokens.map((tokenAddress, i) => {
      const t = pool.tokensMap[tokenAddress.toLowerCase()];
      if (t.address.toLowerCase() === tokenIn.toLowerCase()) indexIn = i;
      if (t.address.toLowerCase() === tokenOut.toLowerCase()) indexOut = i;

      balances.push(poolState.tokens[t.address.toLowerCase()].balance);
      scalingFactors.push(
        poolState.tokens[t.address.toLowerCase()].scalingFactor || 0n,
      );
      return t.address;
    });

    const tokenInLatestFXPrice = pool.tokens[indexIn].token?.latestFXPrice;
    const tokenOutLatestFXPrice = pool.tokens[indexOut].token?.latestFXPrice;
    if (!tokenInLatestFXPrice || !tokenOutLatestFXPrice)
      throw 'FX Pool Missing LatestFxPrice';

    const poolPairData: FxPoolPairData = {
      tokens,
      balances,
      indexIn,
      indexOut,
      scalingFactors,
      alpha: safeParseFixed(pool.alpha, 18),
      beta: safeParseFixed(pool.beta, 18),
      lambda: safeParseFixed(pool.lambda, 18),
      delta: safeParseFixed(pool.delta, 18),
      epsilon: safeParseFixed(pool.epsilon, 18),
      tokenInLatestFXPrice: safeParseFixed(tokenInLatestFXPrice, 0),
      tokenOutLatestFXPrice: safeParseFixed(tokenOutLatestFXPrice, 0),
    };

    return poolPairData;
  }

  /*
  Helper function to construct onchain multicall data for StablePool.
  */
  getOnChainCalls(pool: SubgraphPoolBase): callData[] {
    const poolCallData: callData[] = [];
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
    return [pools, startIndex];
  }

  /*
    Fx pool logic has an alpha region where it halts swaps.
    maxLimit  = [(1 + alpha) * oGLiq * 0.5] - token value in numeraire
    */
  getSwapMaxAmount(poolPairData: FxPoolPairData, side: SwapSide): bigint {
    return 0n;
  }
}
