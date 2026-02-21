"""
Sync transcript_insights to Google Sheets via gspread.

Setup (one-time):
  1. Go to https://console.cloud.google.com/
  2. Create a project (or use existing)
  3. Enable "Google Sheets API" and "Google Drive API"
  4. Create a Service Account: IAM & Admin > Service Accounts > Create
  5. Create a JSON key: Service Account > Keys > Add Key > JSON
  6. Save the JSON file as google_credentials.json in this directory
  7. Create a Google Sheet and share it (Editor) with the service account email
     (the email looks like: name@project-id.iam.gserviceaccount.com)
  8. Copy the Sheet ID from the URL:
     https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit
  9. Add to .env:
     GOOGLE_SHEET_ID=<your-sheet-id>
     GOOGLE_CREDENTIALS_FILE=google_credentials.json

Usage:
  python sync_sheets.py              # Full sync
  python sync_sheets.py --dry-run    # Show what would be synced
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import time

import gspread
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

from src.connectors.supabase import get_client
from src.skills.taxonomy import (
    HR_CATEGORIES, MODULES, PAIN_SUBTYPES, DEAL_FRICTION_SUBTYPES,
    FAQ_SUBTYPES, COMPETITIVE_RELATIONSHIPS,
)

# ── Display name lookups ──

INSIGHT_TYPE_DISPLAY = {
    "pain": "Dolor / Problema",
    "product_gap": "Feature Faltante",
    "competitive_signal": "Señal Competitiva",
    "deal_friction": "Fricción del Deal",
    "faq": "Pregunta Frecuente",
}

SUBTYPE_DISPLAY = {}
for code, v in PAIN_SUBTYPES.items():
    SUBTYPE_DISPLAY[code] = v["display_name"]
for code, v in DEAL_FRICTION_SUBTYPES.items():
    SUBTYPE_DISPLAY[code] = v["display_name"]
for code, v in FAQ_SUBTYPES.items():
    SUBTYPE_DISPLAY[code] = v["display_name"]
for code, v in COMPETITIVE_RELATIONSHIPS.items():
    SUBTYPE_DISPLAY[code] = v["display_name"]

MODULE_DISPLAY = {code: v["display_name"] for code, v in MODULES.items()}
MODULE_STATUS = {code: v["status"] for code, v in MODULES.items()}
MODULE_HR_CAT = {code: v["hr_category"] for code, v in MODULES.items()}
HR_CAT_DISPLAY = {code: v["display_name"] for code, v in HR_CATEGORIES.items()}

GAP_PRIORITY_DISPLAY = {
    "must_have": "Debe tener",
    "nice_to_have": "Deseable",
    "dealbreaker": "Dealbreaker",
}

COLUMNS = [
    "transcript_id", "transcript_chunk",
    "deal_id", "deal_name", "company_name", "region", "country",
    "industry", "company_size", "deal_stage", "deal_owner",
    "segment", "amount", "call_date",
    "insight_type", "insight_type_display",
    "insight_subtype", "insight_subtype_display",
    "module", "module_display", "module_status",
    "hr_category", "hr_category_display",
    "summary", "verbatim_quote", "confidence",
    "competitor_name", "competitor_relationship", "competitor_relationship_display",
    "feature_name", "feature_name_display",
    "gap_description", "gap_priority", "gap_priority_display",
    "faq_topic",
    "processed_at",
]


def fetch_all_insights() -> list[dict]:
    """Fetch all insights from Supabase with pagination."""
    client = get_client()

    # Load feature display names from DB
    feat_resp = client.table("tax_feature_names").select("code,display_name").execute()
    feature_display = {r["code"]: r["display_name"] for r in feat_resp.data}

    all_data = []
    offset = 0
    page_size = 1000
    while True:
        resp = (
            client.table("transcript_insights")
            .select("*")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        all_data.extend(resp.data)
        if len(resp.data) < page_size:
            break
        offset += page_size
        if len(all_data) % 5000 == 0:
            logger.info(f"  Loaded {len(all_data)} rows...")

    logger.info(f"Fetched {len(all_data)} insights from Supabase")

    # Enrich with display names
    for row in all_data:
        row["insight_type_display"] = INSIGHT_TYPE_DISPLAY.get(
            row.get("insight_type"), row.get("insight_type")
        )
        row["insight_subtype_display"] = SUBTYPE_DISPLAY.get(
            row.get("insight_subtype"), row.get("insight_subtype")
        )
        mod = row.get("module")
        row["module_display"] = MODULE_DISPLAY.get(mod, mod) if mod else ""
        row["module_status"] = MODULE_STATUS.get(mod, "") if mod else ""
        hr_cat = MODULE_HR_CAT.get(mod) if mod else None
        row["hr_category"] = hr_cat or ""
        row["hr_category_display"] = HR_CAT_DISPLAY.get(hr_cat, "") if hr_cat else ""
        row["competitor_relationship_display"] = COMPETITIVE_RELATIONSHIPS.get(
            row.get("competitor_relationship"), {}
        ).get("display_name", row.get("competitor_relationship") or "")
        feat = row.get("feature_name")
        row["feature_name_display"] = feature_display.get(feat, feat) if feat else ""
        row["gap_priority_display"] = GAP_PRIORITY_DISPLAY.get(
            row.get("gap_priority"), row.get("gap_priority") or ""
        )

    return all_data


def sync_to_sheets(dry_run: bool = False) -> None:
    """Sync all insights to Google Sheets."""
    sheet_id = os.getenv("GOOGLE_SHEET_ID")
    creds_file = os.getenv("GOOGLE_CREDENTIALS_FILE", "google_credentials.json")

    if not sheet_id:
        logger.error(
            "GOOGLE_SHEET_ID not set in .env\n"
            "  1. Create a Google Sheet\n"
            "  2. Copy the ID from the URL: https://docs.google.com/spreadsheets/d/<ID>/edit\n"
            "  3. Add GOOGLE_SHEET_ID=<ID> to .env"
        )
        sys.exit(1)

    if not os.path.exists(creds_file):
        logger.error(
            f"Credentials file not found: {creds_file}\n"
            "  1. Go to https://console.cloud.google.com/\n"
            "  2. Enable Google Sheets API + Google Drive API\n"
            "  3. Create a Service Account + JSON key\n"
            "  4. Save as google_credentials.json\n"
            "  5. Share the Sheet with the service account email"
        )
        sys.exit(1)

    # Fetch data
    logger.info("Fetching insights from Supabase...")
    data = fetch_all_insights()

    if dry_run:
        logger.info(f"Dry run: would sync {len(data)} rows with {len(COLUMNS)} columns")
        return

    # Connect to Google Sheets
    logger.info("Connecting to Google Sheets...")
    gc = gspread.service_account(filename=creds_file)
    sh = gc.open_by_key(sheet_id)

    # Use first worksheet (or create "Insights" sheet)
    try:
        ws = sh.worksheet("Insights")
        logger.info("Found existing 'Insights' worksheet")
    except gspread.exceptions.WorksheetNotFound:
        ws = sh.add_worksheet(title="Insights", rows=len(data) + 1, cols=len(COLUMNS))
        logger.info("Created 'Insights' worksheet")

    # Build rows: header + data
    header = COLUMNS
    rows = [header]
    for row in data:
        rows.append([str(row.get(col) or "") for col in COLUMNS])

    logger.info(f"Writing {len(rows) - 1} rows to Google Sheets...")

    # Clear and write in batches (Sheets API limit: ~10M cells per request)
    ws.clear()

    # Resize worksheet
    ws.resize(rows=len(rows), cols=len(COLUMNS))

    # Write in batches of 5000 rows to avoid API limits
    batch_size = 5000
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        start_row = i + 1
        end_row = start_row + len(batch) - 1
        end_col = chr(ord("A") + len(COLUMNS) - 1) if len(COLUMNS) <= 26 else None

        # Use column letter range for gspread
        if end_col:
            cell_range = f"A{start_row}:{end_col}{end_row}"
        else:
            # For >26 columns, compute two-letter column
            col_idx = len(COLUMNS)
            if col_idx <= 26:
                end_col = chr(ord("A") + col_idx - 1)
            else:
                end_col = chr(ord("A") + (col_idx - 1) // 26 - 1) + chr(ord("A") + (col_idx - 1) % 26)
            cell_range = f"A{start_row}:{end_col}{end_row}"

        ws.update(cell_range, batch)
        logger.info(f"  Written rows {start_row}-{end_row}")

        if i + batch_size < len(rows):
            time.sleep(2)  # Rate limit

    # Format header row
    ws.format("1:1", {"textFormat": {"bold": True}})
    ws.freeze(rows=1)

    logger.info(f"Sync complete: {len(rows) - 1} rows written to Google Sheets")
    logger.info(f"Sheet URL: https://docs.google.com/spreadsheets/d/{sheet_id}/edit")


def main():
    parser = argparse.ArgumentParser(description="Sync insights to Google Sheets")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be synced")
    args = parser.parse_args()

    sync_to_sheets(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
