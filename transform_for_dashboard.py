"""
transform_for_dashboard.py — Pipeline Output → Dashboard Format

The pipeline (pipeline.py) produces records like:
  {
    "name": "Smile Care",
    "category": "dentist",
    "location": { "city": "Chennai", "state": "Tamil Nadu", "country": "India" },
    "search_engine": "practo",
    "search_url": "https://www.practo.com/..."
  }

The dashboard expects ALL of the above PLUS:
  id, phone, email, website, status, notes

This script adds those missing fields and outputs a dashboard-ready JSON file.

Usage:
    python transform_for_dashboard.py pipeline_output.json
    python transform_for_dashboard.py pipeline_output.json --out my_leads.json
"""

import json
import sys
import argparse
from pathlib import Path


DEFAULTS = {
    "phone": "",
    "email": "",
    "website": "",
    "status": "Not Contacted",
    "notes": "",
}

VALID_STATUSES = {"Not Contacted", "Contacted", "Follow-up", "Closed"}


def transform(records: list[dict]) -> list[dict]:
    """
    Enrich pipeline output records with dashboard-required fields.

    Rules:
    - Adds a sequential 'id' starting from 1.
    - Injects empty strings for phone, email, website, notes if missing.
    - Defaults status to 'Not Contacted' if missing or invalid.
    - Preserves ALL existing fields (search_engine, search_url, etc.) unchanged.
    """
    result = []
    for idx, rec in enumerate(records, start=1):
        enriched = {
            "id": rec.get("id", idx),           # preserve existing id if present
            "name": rec.get("name", "Unnamed"),
            "category": rec.get("category", "unknown"),
            "location": rec.get("location", {"city": "", "state": "", "country": ""}),
        }

        # Preserve pipeline-specific fields
        if "search_engine" in rec:
            enriched["search_engine"] = rec["search_engine"]
        if "search_url" in rec:
            enriched["search_url"] = rec["search_url"]

        # Add CRM fields (use existing values if re-transforming an already-enriched file)
        for field, default in DEFAULTS.items():
            value = rec.get(field, default)
            # Validate status
            if field == "status" and value not in VALID_STATUSES:
                value = "Not Contacted"
            enriched[field] = value

        result.append(enriched)

    return result


def main():
    parser = argparse.ArgumentParser(
        description="Convert pipeline output JSON to Lead Dashboard format."
    )
    parser.add_argument("input", help="Path to pipeline output JSON file")
    parser.add_argument("--out", default=None, help="Output file path (default: <input>_dashboard.json)")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: File not found: {input_path}")
        sys.exit(1)

    with open(input_path) as f:
        try:
            data = json.load(f)
        except json.JSONDecodeError as e:
            print(f"Error: Invalid JSON — {e}")
            sys.exit(1)

    if not isinstance(data, list):
        data = [data]

    enriched = transform(data)

    out_path = Path(args.out) if args.out else input_path.with_name(input_path.stem + "_dashboard.json")
    with open(out_path, "w") as f:
        json.dump(enriched, f, indent=2, ensure_ascii=False)

    print(f"Transformed {len(enriched)} records → {out_path}")
    print(f"Fields added: id, phone, email, website, status, notes")
    print(f"Fields preserved: name, category, location, search_engine, search_url")


if __name__ == "__main__":
    main()