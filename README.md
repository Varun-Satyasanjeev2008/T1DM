# T1DM — Blood Glucose Forecasting (CGM-only)

Forecasting blood glucose levels for Type 1 Diabetes (T1D) patients at multiple horizons, using an XGBoost regression model trained on continuous glucose monitoring (CGM) data.

## Problem Statement

Type 1 diabetes requires constant blood glucose management, since patients produce no insulin of their own. Two failure modes threaten patients daily: hypoglycemia (glucose below 70 mg/dL, which can cause seizures or coma within minutes) and hyperglycemia (above 180 mg/dL, which causes long-term damage to eyes, kidneys, and nerves). Reactive monitoring — checking a current glucose reading — doesn't give patients enough lead time to prevent these events.

Prior work (e.g. Xiong et al., 2025) achieves strong forecasting accuracy by combining CGM data with insulin dosing and meal composition. The dataset available for this project contained only the glucose stream itself, with no insulin or meal records. This project asks: **how accurate and clinically safe can glucose forecasting be using CGM data alone?**

## Approach

**Data:** OhioT1DM dataset (2020 cohort), 5-minute CGM sampling, pre-split into training and testing sets.

**Feature engineering**, derived entirely from the raw glucose stream:
- Lags (5–60 minutes back)
- Rolling mean and standard deviation (30/60/90/120-minute windows)
- Rate of change (5-minute and 30-minute deltas)
- Cyclical time-of-day encoding (hour sine/cosine)

**Model:** XGBoost regression, one model trained per prediction horizon (30, 60, 90, 120 minutes).

**Evaluation:** RMSE and Clarke Error Grid Analysis (EGA) — the clinical safety standard that classifies each prediction into zones A–E based on whether it would lead to a safe (A/B) or dangerous (C/D/E) treatment decision.

## Results (test set)

| Horizon | RMSE (mg/dL) | Clinically Safe (A+B) |
|---|---|---|
| 30 min | 20.94 | 98.29% |
| 60 min | 33.67 | 96.72% |
| 90 min | 42.44 | 95.14% |
| 120 min | 48.08 | 93.87% |

Accuracy decreases and risk zones grow with horizon, which is expected — missing insulin and meal data costs more the further ahead the model has to predict.

## Repo Structure

```
├── Frontend/          # Dashboard UI (HTML/CSS/JS)
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── Model/
│   └── xbg1.ipynb      # Feature engineering, XGBoost training + evaluation
└── README.md
```

## Data

This project uses the OhioT1DM dataset, which requires a signed data use agreement to access and is not included in this repository. To run the notebook:

1. Request access to OhioT1DM
2. Place `ohio_training_combined.csv` and `ohio_testing_combined.csv` in the `Model/` folder
3. Run `Model/xbg1.ipynb` top to bottom

## Running the Frontend

Open `Frontend/index.html` directly in a browser, or serve the folder with a local server (e.g. VS Code's Live Server extension).
