import { FXPoolPairData } from './FXPool';
import { BigNumber, parseFixed } from '@ethersproject/bignumber';
import { safeParseFixed } from './utils/utils';
import { BigNumber as OldBigNumber, bnum } from './utils/bignumber';

/**
 * =========================
 * Constants
 * =========================
 */

export const ONE_36 = parseFixed('1', 36);
const ONE_TO_THE_THIRTEEN_NUM_36 = parseFixed('10000000000000', 36);
const CURVEMATH_MAX_DIFF_36 = parseFixed('-0.000001000000000000024', 36);
const CURVEMATH_MAX_36 = parseFixed('0.25', 36); //CURVEMATH MAX from contract

const USDC_ETHEREUM = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const USDC_POLYGON = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174';
const USDC_AVALANCHE = '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e';

/**
 * =========================
 * Interfaces & enums
 * =========================
 */

interface ReservesInNumeraire {
  tokenInReservesInNumeraire_36: BigNumber;
  tokenOutReservesInNumeraire_36: BigNumber;
  _oGLiq_36: BigNumber;
}

interface ParsedFXPoolData {
  alpha_36: BigNumber;
  beta_36: BigNumber;
  delta_36: BigNumber;
  epsilon_36: BigNumber;
  lambda_36: BigNumber;
  baseTokenRate_36: BigNumber;
  _oGLiq_36: BigNumber;
  _nGLiq_36: BigNumber;
  _oBals_36: BigNumber[];
  _nBals_36: BigNumber[];
  givenAmountInNumeraire_36: BigNumber;
}

export enum CurveMathRevert {
  LowerHalt = 'CurveMath/lower-halt',
  UpperHalt = 'CurveMath/upper-halt',
  SwapInvariantViolation = 'CurveMath/swap-invariant-violation',
  SwapConvergenceFailed = 'CurveMath/swap-convergence-failed',
  CannotSwap = 'CannotSwap',
}

/**
 * =========================
 * Public functions
 * =========================
 */

// Used to calculate numeraire values of the raw amount balances
// from the subgraph to calculate the limit to swap
export const poolBalancesToNumeraire = (
  poolPairData: FXPoolPairData,
): ReservesInNumeraire => {
  // amount * rate / 10^poolPairData.decimalsIn -> rate: (_rate / 10^fxOracleDecimals)
  // _amount.mul(_rate).div(basefxOracleDecimals).divu(baseDecimals);

  const tokenInNumeraire = viewNumeraireAmount(
    safeParseFixed(poolPairData.balanceIn.toString(), 36),
    poolPairData.decimalsIn,
    poolPairData.tokenInLatestFXPrice,
    poolPairData.tokenInFXOracleDecimals,
  );

  const tokenOutNumeraire = viewNumeraireAmount(
    safeParseFixed(poolPairData.balanceOut.toString(), 36),
    poolPairData.decimalsOut,
    poolPairData.tokenOutLatestFXPrice,
    poolPairData.tokenOutFXOracleDecimals,
  );

  return {
    tokenInReservesInNumeraire_36: tokenInNumeraire,
    tokenOutReservesInNumeraire_36: tokenOutNumeraire,
    _oGLiq_36: tokenInNumeraire.add(tokenOutNumeraire),
  };
};

// Base Assimilator Functions
// calculations are from the BaseToUsdAssimilator

/**
 *
 * @param _amount in numeraire
 * @param tokenDecimals
 * @param rate in wei
 * @param fxOracleDecimals
 * @returns amount in wei
 */
export const viewRawAmount = (
  amount_36: BigNumber,
  tokenDecimals: number,
  rate: BigNumber, // wei
  fxOracleDecimals: number,
): BigNumber => {
  // Solidity: `amount.mulu(baseDecimals).mul(baseOracleDecimals).div(_rate);

  const val = safeParseFixed(amount_36.toString(), tokenDecimals)
    .div(ONE_36)
    .mul(safeParseFixed('1', fxOracleDecimals))
    .mul(ONE_36)
    .div(safeParseFixed(rate.toString(), 36));
  return val;
};

/**
 * @param _amount in wei
 * @param tokenDecimals
 * @param rate in wei
 * @param fxOracleDecimals
 * @returns amount in numeraire in 36 decimals
 */
export function viewNumeraireAmount(
  amount_36: BigNumber, // wei
  tokenDecimals: number,
  rate: BigNumber, // wei
  fxOracleDecimals: number,
): BigNumber {
  // Solidity: _amount.mul(_rate).div(basefxOracleDecimals).divu(baseDecimals);

  const val = amount_36
    .mul(safeParseFixed(rate.toString(), 36))
    .div(ONE_36)
    .div(ONE_36)
    .div(safeParseFixed('1', fxOracleDecimals))
    .mul(ONE_36)
    .div(safeParseFixed('1', tokenDecimals));

  return val;
}

// origin swap
export function exactTokenInForTokenOut(
  amount: OldBigNumber,
  poolPairData: FXPoolPairData,
): BigInt {
  const parsedFXPoolData = _getParsedFXPoolData(
    safeParseFixed(amount.toString(), 36),
    poolPairData,
    true,
  );

  const targetAmountInNumeraire_36 = parsedFXPoolData.givenAmountInNumeraire_36;

  if (poolPairData.tokenIn === poolPairData.tokenOut) {
    return BigInt(
      viewRawAmount(
        targetAmountInNumeraire_36,
        poolPairData.decimalsIn,
        poolPairData.tokenInLatestFXPrice,
        poolPairData.tokenInFXOracleDecimals,
      ).toString(),
    ); // must be the token out
  }

  const _oGLiq_36 = parsedFXPoolData._oGLiq_36;
  const _nGLiq_36 = parsedFXPoolData._nGLiq_36;
  const _oBals_36 = parsedFXPoolData._oBals_36;
  const _nBals_36 = parsedFXPoolData._nBals_36;

  const _amt_36 = _calculateTrade(
    _oGLiq_36, // _oGLiq
    _nGLiq_36, // _nGLiq
    _oBals_36, // _oBals
    _nBals_36, // _nBals
    targetAmountInNumeraire_36, // input amount
    _isUSDC(poolPairData.tokenIn) ? 1 : 0, // if USDC return base token (index 1), else return 0 for USDC out
    parsedFXPoolData,
  );

  if (_amt_36 === undefined) {
    throw new Error(CurveMathRevert.CannotSwap);
  } else {
    const epsilon_36 = parsedFXPoolData.epsilon_36;
    const _amtWithFee_36 = _amt_36[0].mul(ONE_36.sub(epsilon_36)).div(ONE_36);

    return BigInt(
      viewRawAmount(
        _amtWithFee_36.abs(),
        poolPairData.decimalsOut,
        poolPairData.tokenOutLatestFXPrice,
        poolPairData.tokenOutFXOracleDecimals,
      ).toString(),
    );
  }
}

// target swap
export function tokenInForExactTokenOut(
  amount: OldBigNumber,
  poolPairData: FXPoolPairData,
): OldBigNumber {
  const parsedFxPoolData = _getParsedFXPoolData(
    safeParseFixed(amount.toString(), 36),
    poolPairData,
    false,
  );
  const targetAmountInNumeraire_36 =
    parsedFxPoolData.givenAmountInNumeraire_36.mul(-1);

  if (poolPairData.tokenIn === poolPairData.tokenOut) {
    bnum(
      viewRawAmount(
        // poolPairData.tokenOut as TokenSymbol,
        targetAmountInNumeraire_36,
        poolPairData.decimalsOut,
        poolPairData.tokenOutLatestFXPrice,
        poolPairData.tokenOutFXOracleDecimals,
      ).toString(),
    ).div(bnum(10).pow(poolPairData.decimalsOut)); // must be the token out
  }

  const _amt_36 = _calculateTrade(
    parsedFxPoolData._oGLiq_36,
    parsedFxPoolData._nGLiq_36,
    parsedFxPoolData._oBals_36,
    parsedFxPoolData._nBals_36,
    targetAmountInNumeraire_36,
    _isUSDC(poolPairData.tokenIn) ? 0 : 1, // if USDC return 0 else return 1 for base token
    parsedFxPoolData,
  );

  if (_amt_36 === undefined) {
    throw new Error(CurveMathRevert.CannotSwap);
  } else {
    const epsilon_36 = safeParseFixed(poolPairData.epsilon.toString(), 18);

    const _amtWithFee = _amt_36[0].mul(ONE_36.add(epsilon_36)).div(ONE_36); // fee retained by the pool

    return bnum(
      viewRawAmount(
        _amtWithFee.abs(),
        poolPairData.decimalsIn,
        poolPairData.tokenInLatestFXPrice,
        poolPairData.tokenInFXOracleDecimals,
      ).toString(),
    ).div(bnum(10).pow(poolPairData.decimalsIn)); // must be the token out
  }
}

/**
 * =========================
 * Core logic
 * =========================
 */

// return outputAmount and ngliq
const _calculateTrade = (
  _oGLiq_36: BigNumber,
  _nGLiq_36: BigNumber,
  _oBals_36: BigNumber[],
  _nBals_36: BigNumber[],
  _inputAmt_36: BigNumber,
  _outputIndex: number,
  poolPairData: ParsedFXPoolData,
): [BigNumber, BigNumber] => {
  const weights_: BigNumber[] = [
    safeParseFixed('0.5', 36),
    safeParseFixed('0.5', 36),
  ]; // const for now since all weights are 0.5

  const alpha_36 = poolPairData.alpha_36;
  const beta_36 = poolPairData.beta_36;
  const delta_36 = poolPairData.delta_36;
  const lambda_36 = poolPairData.lambda_36;

  let outputAmt_ = _inputAmt_36.mul(-1);

  const omega_36 = _calculateFee(
    _oGLiq_36,
    _oBals_36,
    beta_36,
    delta_36,
    weights_,
  );

  let psi_36: BigNumber;

  for (let i = 0; i < 32; i++) {
    psi_36 = _calculateFee(_nGLiq_36, _nBals_36, beta_36, delta_36, weights_);

    const prevAmount = outputAmt_;

    outputAmt_ = omega_36.lt(psi_36)
      ? _inputAmt_36.add(omega_36.sub(psi_36)).mul(-1)
      : _inputAmt_36
          .add(lambda_36.mul(omega_36.sub(psi_36)).div(ONE_36))
          .mul(-1);

    if (
      outputAmt_
        .mul(ONE_36)
        .div(ONE_TO_THE_THIRTEEN_NUM_36)
        .eq(prevAmount.mul(ONE_36).div(ONE_TO_THE_THIRTEEN_NUM_36))
    ) {
      _nGLiq_36 = _oGLiq_36.add(_inputAmt_36).add(outputAmt_);

      _nBals_36[_outputIndex] = _oBals_36[_outputIndex].add(outputAmt_);
      // throws error already, removed if statement
      _enforceHalts(
        _oGLiq_36,
        _nGLiq_36,
        _oBals_36,
        _nBals_36,
        weights_,
        alpha_36,
      );
      _enforceSwapInvariant(_oGLiq_36, omega_36, _nGLiq_36, psi_36);
      return [outputAmt_, _nGLiq_36];
    } else {
      _nGLiq_36 = _oGLiq_36.add(_inputAmt_36).add(outputAmt_);
      _nBals_36[_outputIndex] = _oBals_36[_outputIndex].add(outputAmt_);
    }
  }

  throw new Error(CurveMathRevert.SwapConvergenceFailed);
};

// invariant enforcement
const _enforceHalts = (
  _oGLiq: BigNumber,
  _nGLiq: BigNumber,
  _oBals: BigNumber[],
  _nBals: BigNumber[],
  _weights: BigNumber[],
  alpha_36: BigNumber,
): boolean => {
  const _length = _nBals.length;

  for (let i = 0; i < _length; i++) {
    const _nIdeal = _nGLiq.mul(_weights[i]).div(ONE_36);

    if (_nBals[i].gt(_nIdeal)) {
      const _upperAlpha = alpha_36.add(ONE_36);

      const _nHalt = _nIdeal.mul(_upperAlpha).div(ONE_36);

      if (_nBals[i].gt(_nHalt)) {
        const _oHalt = _oGLiq
          .mul(_weights[i])
          .div(ONE_36)
          .mul(_upperAlpha)
          .div(ONE_36);

        if (_oBals[i].lt(_oHalt)) {
          throw new Error(CurveMathRevert.UpperHalt);
        }
        if (_nBals[i].sub(_nHalt).gt(_oBals[i].sub(_oHalt))) {
          throw new Error(CurveMathRevert.UpperHalt);
        }
      }
    } else {
      const _lowerAlpha = ONE_36.sub(alpha_36);

      const _nHalt = _nIdeal.mul(_lowerAlpha).div(ONE_36);

      if (_nBals[i].lt(_nHalt)) {
        let _oHalt = _oGLiq.mul(_weights[i]).div(ONE_36);
        _oHalt = _oHalt.mul(_lowerAlpha).div(ONE_36);

        if (_oBals[i].gt(_oHalt)) {
          throw new Error(CurveMathRevert.LowerHalt);
        }
        if (_nHalt.sub(_nBals[i]).gt(_oHalt.sub(_oBals[i]))) {
          throw new Error(CurveMathRevert.LowerHalt);
        }
      }
    }
  }
  return true;
};

const _enforceSwapInvariant = (
  _oGLiq_36: BigNumber,
  _omega_36: BigNumber,
  _nGLiq_36: BigNumber,
  _psi_36: BigNumber,
): boolean => {
  const _nextUtil = _nGLiq_36.sub(_psi_36);

  const _prevUtil = _oGLiq_36.sub(_omega_36);

  const _diff = _nextUtil.sub(_prevUtil);

  // from int128 private constant MAX_DIFF = -0x10C6F7A0B5EE converted to plain decimals
  if (_diff.gt(0) || _diff.gte(CURVEMATH_MAX_DIFF_36)) {
    return true;
  } else {
    throw new Error(CurveMathRevert.SwapInvariantViolation);
  }
};

// Curve Math
// calculations are from CurveMath.sol
const calculateMicroFee = (
  _bal: BigNumber,
  _ideal: BigNumber,
  _beta: BigNumber,
  _delta: BigNumber,
): BigNumber => {
  let _threshold, _feeMargin;
  let fee_ = BigNumber.from(0);

  if (_bal.lt(_ideal)) {
    _threshold = _ideal.mul(ONE_36.sub(_beta)).div(ONE_36);

    if (_bal.lt(_threshold)) {
      _feeMargin = _threshold.sub(_bal);
      fee_ = _feeMargin.mul(ONE_36).div(_ideal);
      fee_ = fee_.mul(_delta).div(ONE_36);

      if (fee_.gt(CURVEMATH_MAX_36)) {
        fee_ = CURVEMATH_MAX_36;
      }

      fee_ = fee_.mul(_feeMargin).div(ONE_36);
    } else {
      fee_ = BigNumber.from(0);
    }
  } else {
    _threshold = _ideal.mul(_beta.add(ONE_36)).div(ONE_36);

    if (_bal.gt(_threshold)) {
      _feeMargin = _bal.sub(_threshold);

      fee_ = _feeMargin.mul(ONE_36).div(_ideal);
      fee_ = fee_.mul(_delta).div(ONE_36);

      if (fee_.gt(CURVEMATH_MAX_36)) fee_ = CURVEMATH_MAX_36;

      fee_ = fee_.mul(_feeMargin).div(ONE_36);
    } else {
      fee_ = BigNumber.from(0);
    }
  }

  return fee_;
};

const _calculateFee = (
  _gLiq: BigNumber,
  _bals: BigNumber[],
  _beta: BigNumber,
  _delta: BigNumber,
  _weights: BigNumber[],
): BigNumber => {
  const _length = _bals.length;
  let psi_36 = BigNumber.from(0);

  for (let i = 0; i < _length; i++) {
    const _ideal = _gLiq.mul(_weights[i]).div(ONE_36);

    // keep away from wei values like how the contract do it
    psi_36 = psi_36.add(calculateMicroFee(_bals[i], _ideal, _beta, _delta));
  }

  return psi_36;
};

/**
 * =========================
 * Private functions
 * =========================
 */

// everything is in order of USDC, base token
const _getParsedFXPoolData = (
  amount_36: BigNumber,
  poolPairData: FXPoolPairData,
  isOriginSwap: boolean,
): ParsedFXPoolData => {
  // reserves are in raw amount, they converted to numeraire
  const baseReserves_36 = _isUSDC(poolPairData.tokenIn)
    ? viewNumeraireAmount(
        safeParseFixed(poolPairData.balanceOut.toString(), 36),
        poolPairData.decimalsOut,
        poolPairData.tokenOutLatestFXPrice,
        poolPairData.tokenOutFXOracleDecimals,
      )
    : viewNumeraireAmount(
        safeParseFixed(poolPairData.balanceIn.toString(), 36),
        poolPairData.decimalsIn,
        poolPairData.tokenInLatestFXPrice,
        poolPairData.tokenInFXOracleDecimals,
      );

  // reserves are not in wei
  const usdcReserves_36 = _isUSDC(poolPairData.tokenIn)
    ? viewNumeraireAmount(
        safeParseFixed(poolPairData.balanceIn.toString(), 36),
        poolPairData.decimalsIn,
        poolPairData.tokenInLatestFXPrice,
        poolPairData.tokenInFXOracleDecimals,
      )
    : viewNumeraireAmount(
        safeParseFixed(poolPairData.balanceOut.toString(), 36),
        poolPairData.decimalsOut,
        poolPairData.tokenOutLatestFXPrice,
        poolPairData.tokenOutFXOracleDecimals,
      );

  // rate is converted from chainlink to the actual rate in decimals
  const baseTokenRate_36 = _isUSDC(poolPairData.tokenIn)
    ? poolPairData.tokenOutLatestFXPrice
        .mul(ONE_36)
        .div(safeParseFixed('1', poolPairData.tokenOutFXOracleDecimals))
    : poolPairData.tokenInLatestFXPrice
        .mul(ONE_36)
        .div(safeParseFixed('1', poolPairData.tokenInFXOracleDecimals));

  // given amount in or out converted to numeraire
  const givenAmountInNumeraire_36 = _calculateGivenAmountInNumeraire(
    isOriginSwap,
    poolPairData,
    amount_36,
  );

  return {
    // poolPairData already has the parameters with 18 decimals
    // therefore we only need to add 18 decimals more
    alpha_36: safeParseFixed(poolPairData.alpha.toString(), 18),
    beta_36: parseFixed(poolPairData.beta.toString(), 18),
    delta_36: parseFixed(poolPairData.delta.toString(), 18),
    epsilon_36: parseFixed(poolPairData.epsilon.toString(), 18),
    lambda_36: parseFixed(poolPairData.lambda.toString(), 18),
    baseTokenRate_36: baseTokenRate_36,
    _oGLiq_36: baseReserves_36.add(usdcReserves_36),
    _nGLiq_36: baseReserves_36.add(usdcReserves_36),
    _oBals_36: [usdcReserves_36, baseReserves_36],
    _nBals_36: _isUSDC(poolPairData.tokenIn)
      ? [
          usdcReserves_36.add(givenAmountInNumeraire_36),
          baseReserves_36.sub(givenAmountInNumeraire_36),
        ]
      : [
          usdcReserves_36.sub(givenAmountInNumeraire_36),
          baseReserves_36.add(givenAmountInNumeraire_36),
        ],

    givenAmountInNumeraire_36: givenAmountInNumeraire_36,
  };
};

const _calculateGivenAmountInNumeraire = (
  isOriginSwap: boolean,
  poolPairData: FXPoolPairData,
  amount_36: BigNumber,
): BigNumber => {
  let calculatedNumeraireAmount_36: BigNumber;

  if (isOriginSwap) {
    // tokenIn is given
    calculatedNumeraireAmount_36 = viewNumeraireAmount(
      safeParseFixed(amount_36.toString(), poolPairData.decimalsIn),
      poolPairData.decimalsIn,
      poolPairData.tokenInLatestFXPrice,
      poolPairData.tokenInFXOracleDecimals,
    );
  } else {
    // tokenOut is given
    calculatedNumeraireAmount_36 = viewNumeraireAmount(
      safeParseFixed(amount_36.toString(), poolPairData.decimalsOut),
      poolPairData.decimalsOut,
      poolPairData.tokenOutLatestFXPrice,
      poolPairData.tokenOutFXOracleDecimals,
    );
  }

  return calculatedNumeraireAmount_36;
};

/**
 * =========================
 * Util functions
 * =========================
 */

const _isUSDC = (address: string) => {
  return [USDC_ETHEREUM, USDC_POLYGON, USDC_AVALANCHE].includes(
    address.toLowerCase(),
  );
};
