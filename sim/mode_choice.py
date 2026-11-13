"""Binary logit mode choice: drive vs transit on door-to-door minutes.

    P(transit) = 1 / (1 + exp(-(ASC + BETA_TIME * (t_drive - t_transit))))

ASC is ONE global constant, calibrated on the baseline so the box-wide transit
share equals TARGET_TRANSIT_SHARE, then held fixed for every scenario.
TODO: per-tract ASC fitted to ACS B08301 tract transit shares (plan "Mode choice"),
car availability from ACS B08141, and a park-and-ride option.
"""
from __future__ import annotations

import numpy as np
from scipy.optimize import brentq

# ASSUMPTION: time sensitivity per minute of door-to-door time difference.
BETA_TIME = 0.08
# PLACEHOLDER: box-wide commute transit share the baseline is calibrated to.
# Stand-in for ACS B08301 (public transportation / workers) over the box tracts.
TARGET_TRANSIT_SHARE = 0.12


def p_transit(drive_min: np.ndarray, transit_min: np.ndarray, asc: float) -> np.ndarray:
    diff = np.where(np.isfinite(transit_min), drive_min - transit_min, -np.inf)
    with np.errstate(over="ignore"):
        return 1.0 / (1.0 + np.exp(-(asc + BETA_TIME * diff)))


def calibrate_asc(drive_min, transit_min, weights, target=TARGET_TRANSIT_SHARE) -> float:
    w = np.asarray(weights, float)

    def f(asc):
        return float((p_transit(drive_min, transit_min, asc) * w).sum() / w.sum()) - target

    return float(brentq(f, -15.0, 15.0))
