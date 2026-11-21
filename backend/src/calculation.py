"""Fit the calibration without allowing target samples into reference training.

Two strategies share the same frozen snapshot:

* ``batch_loo`` — the incumbent: per-batch leave-one-out RMSE and every
  reference batch weighted equally in the final Ridge fit.
* ``lot_groupout`` — the candidate: all freeze-dry batches made from one raw
  material lot are held out together (leave-one-group-out), and each material
  lot carries equal weight in the final Ridge fit so a lot feeding several
  dryers cannot dominate the regression.
"""
import math

import numpy as np
from sklearn.linear_model import Ridge
from sklearn.preprocessing import PowerTransformer

from .models import FitStrategy

FEATURES = ['固形物 %', '投料厚度 / 标称厚度', '真空段跨度 min', '真空段平均压力 Pa', '真空段平均板温 °C']
ALPHA = 0.65
SEED = 1062


def _weights_for(strategy, material_lots):
    if strategy != FitStrategy.LOT_GROUPOUT:
        return np.ones(len(material_lots))
    _, inverse, counts = np.unique(material_lots, return_inverse=True, return_counts=True)
    return 1.0 / counts[inverse]


def ridge_fit(x, y, target, weights):
    active = np.ptp(x, axis=0) > 1e-9
    if not active.any():
        return float(np.average(y, weights=weights)), {}, {}
    variable = x[:, active]
    transformer = PowerTransformer(method='yeo-johnson', standardize=True)
    transformed = transformer.fit_transform(variable)
    model = Ridge(alpha=ALPHA, solver='svd').fit(transformed, y, sample_weight=weights)
    prediction = model.predict(transformer.transform(target[None, active]))[0]
    names = [name for name, enabled in zip(FEATURES, active, strict=True) if enabled]
    return float(prediction), dict(zip(names, map(float, transformer.lambdas_))), dict(zip(names, map(float, model.coef_)))


def _folds(training, strategy):
    if strategy == FitStrategy.LOT_GROUPOUT:
        lots = [item['material_lot'] for item in training]
        for lot in dict.fromkeys(lots):
            held = [index for index, value in enumerate(lots) if value == lot]
            keep = [index for index, value in enumerate(lots) if value != lot]
            yield lot, keep, held
        return
    for index in range(len(training)):
        yield training[index]['batch'], [i for i in range(len(training)) if i != index], [index]


def cross_validation(training, strategy):
    x = np.asarray([item['features'] for item in training], dtype=float)
    y = np.asarray([item['observed'] for item in training], dtype=float)
    lots = np.asarray([item['material_lot'] for item in training])
    groups = []
    for label, keep, held in _folds(training, strategy):
        fold_weights = _weights_for(strategy, lots[keep])
        predictions = []
        for index in held:
            prediction, _, _ = ridge_fit(x[keep], y[keep], x[index], fold_weights)
            if not math.isfinite(prediction):
                raise ValueError('交叉验证产生非有限预测，请检查参考工况的分布')
            predictions.append(prediction)
        groups.append({
            'label': label,
            'held_out_batches': [training[index]['batch'] for index in held],
            'material_lot': training[held[0]]['material_lot'],
            'observed_pct': round(float(np.mean([y[index] for index in held])), 6),
            'prediction_pct': round(float(np.mean(predictions)), 6),
        })
    return groups


def classify(group, window):
    observed_in = window[0] <= group['observed_pct'] <= window[1]
    predicted_in = window[0] <= group['prediction_pct'] <= window[1]
    if observed_in and predicted_in:
        return 'correct_in'      # 窗内判窗内
    if not observed_in and not predicted_in:
        return 'correct_out'     # 超窗判超窗
    if not observed_in and predicted_in:
        return 'false_accept'    # 误放：实测超窗却预报窗内
    return 'false_reject'        # 误留：实测窗内却预报超窗


def evaluate_strategies(snapshot):
    training = snapshot['training']
    window = snapshot['window']
    x = np.asarray([item['features'] for item in training], dtype=float)
    y = np.asarray([item['observed'] for item in training], dtype=float)
    if not np.any(np.ptp(x, axis=0) > 1e-9):
        raise ValueError('参考批次的工况特征缺少变化，无法拟合校准模型')
    lots = np.asarray([item['material_lot'] for item in training])
    n_lots = len(set(lots))
    evaluations = {}
    for strategy in FitStrategy:
        groups = cross_validation(training, strategy)
        for group in groups:
            group['verdict'] = classify(group, window)
        counts = {name: 0 for name in ('correct_in', 'correct_out', 'false_accept', 'false_reject')}
        squared_error = []
        for group in groups:
            counts[group['verdict']] += 1
            squared_error.append((group['prediction_pct'] - group['observed_pct']) ** 2)
        evaluations[strategy.value] = {
            'strategy': strategy.value,
            'groups': groups,
            'rmse_pct': round(float(np.sqrt(np.mean(squared_error))), 6),
            'false_accept': counts['false_accept'],
            'false_reject': counts['false_reject'],
            'correct_in': counts['correct_in'],
            'correct_out': counts['correct_out'],
            'n_material_lots': n_lots,
        }
    candidate = evaluations[FitStrategy.LOT_GROUPOUT.value]
    incumbent = evaluations[FitStrategy.BATCH_LOO.value]
    candidate['eligible'] = (
        n_lots >= 3
        and candidate['false_accept'] < incumbent['false_accept']
        and candidate['false_reject'] <= incumbent['false_reject']
    )
    candidate['enablement_basis'] = enablement_basis(candidate, incumbent, n_lots)
    return evaluations


def enablement_basis(candidate, incumbent, n_lots):
    reasons = []
    if n_lots < 3:
        reasons.append(f'原料批仅 {n_lots} 组，不足三组，沿用现行逐批留一模型')
    if candidate['false_accept'] >= incumbent['false_accept']:
        reasons.append(f"候选误放 {candidate['false_accept']} 组，未少于现行 {incumbent['false_accept']} 组")
    if candidate['false_reject'] > incumbent['false_reject']:
        reasons.append(f"候选误留 {candidate['false_reject']} 组，多于现行 {incumbent['false_reject']} 组")
    if not reasons:
        reasons.append(
            f"候选误放 {candidate['false_accept']} 组少于现行 {incumbent['false_accept']} 组，"
            f"误留 {candidate['false_reject']} 组未多于现行 {incumbent['false_reject']} 组，满足按配方启用条件"
        )
    return '；'.join(reasons)


def estimate(snapshot):
    training = snapshot['training']
    x = np.asarray([item['features'] for item in training], dtype=float)
    y = np.asarray([item['observed'] for item in training], dtype=float)
    target = np.asarray(snapshot['features'], dtype=float)
    strategy = FitStrategy(snapshot.get('fit_strategy', FitStrategy.BATCH_LOO.value))
    lots = np.asarray([item['material_lot'] for item in training])
    groups = cross_validation(training, strategy)
    for group in groups:
        group['verdict'] = classify(group, snapshot['window'])
    residuals = [(group['prediction_pct'] - group['observed_pct']) ** 2 for group in groups]
    weights = _weights_for(strategy, lots)
    prediction, lambdas, coefficients = ridge_fit(x, y, target, weights)
    values = [prediction, *residuals, *lambdas.values(), *coefficients.values()]
    if not all(math.isfinite(value) for value in values):
        raise ValueError('模型产生非有限值，请检查参考工况的分布')
    weighting = '原料批等权' if strategy == FitStrategy.LOT_GROUPOUT else '批次等权'
    return {
        'prediction_pct': round(prediction, 6),
        'cv_rmse': round(float(np.sqrt(np.mean(residuals))), 6),
        'loo_rmse': round(float(np.sqrt(np.mean(residuals))), 6),
        'n_references': len(training), 'n_material_lots': len(set(lots)),
        'fit_strategy': strategy.value, 'weighting': weighting,
        'cv_scheme': '原料批整组留出' if strategy == FitStrategy.LOT_GROUPOUT else '逐批留一',
        'cv_groups': groups,
        'alpha': ALPHA, 'seed': SEED, 'solver': 'svd',
        'lambdas': {name: round(value, 10) for name, value in lambdas.items()},
        'coefficients': {name: round(value, 10) for name, value in coefficients.items()},
        'feature_names': FEATURES,
    }
