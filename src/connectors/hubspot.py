"""
HubSpot CRM API v3 client: fetch deals, companies, contacts, and associations.
API docs: https://developers.hubspot.com/docs/api-reference
"""

from __future__ import annotations

import logging
import time
from typing import Any

import requests
from tenacity import retry, stop_after_attempt, wait_exponential

from src import config

logger = logging.getLogger(__name__)

BASE_URL = "https://api.hubapi.com"

DEAL_PROPERTIES = [
    "dealname", "dealstage", "pipeline", "amount",
    "closedate", "createdate", "hubspot_owner_id",
    "hs_object_id", "segment_v2", "region", "pais",
    "users_by_contract", "sales_lost_reason", "industria_hu",
    "who_closed_the_lead",  # Account Executive (owner ID)
]

COMPANY_PROPERTIES = [
    "domain", "name", "industry", "numberofemployees",
    "country", "state", "city", "segment",
    "hs_employee_range", "total_employees",
]

CONTACT_PROPERTIES = [
    "email", "firstname", "lastname", "company",
    "hs_object_id",
]


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {config.HUBSPOT_API_KEY}",
        "Content-Type": "application/json",
    }


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=30))
def _get(endpoint: str, params: dict | None = None) -> dict:
    url = f"{BASE_URL}{endpoint}"
    resp = requests.get(url, headers=_headers(), params=params or {}, timeout=30)
    if resp.status_code == 429:
        retry_after = int(resp.headers.get("Retry-After", 10))
        logger.warning(f"Rate limited, waiting {retry_after}s...")
        time.sleep(retry_after)
        raise Exception("Rate limited")
    resp.raise_for_status()
    return resp.json()


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=30))
def _post(endpoint: str, json_body: dict) -> dict:
    url = f"{BASE_URL}{endpoint}"
    resp = requests.post(url, headers=_headers(), json=json_body, timeout=30)
    if resp.status_code == 429:
        retry_after = int(resp.headers.get("Retry-After", 10))
        logger.warning(f"Rate limited, waiting {retry_after}s...")
        time.sleep(retry_after)
        raise Exception("Rate limited")
    resp.raise_for_status()
    return resp.json()


# ── Deals ──

def fetch_all_deals() -> list[dict]:
    """Fetch all deals with properties and associations."""
    all_deals = []
    after = None

    while True:
        params = {
            "properties": ",".join(DEAL_PROPERTIES),
            "associations": "companies,contacts",
            "limit": 100,
        }
        if after:
            params["after"] = after

        data = _get("/crm/v3/objects/deals", params)
        results = data.get("results", [])
        all_deals.extend(results)
        logger.info(f"Fetched {len(results)} deals (total: {len(all_deals)})")

        paging = data.get("paging", {})
        after = paging.get("next", {}).get("after")
        if not after:
            break

        time.sleep(0.15)  # Respect rate limits

    return all_deals


def fetch_pipelines() -> dict[str, dict]:
    """Fetch deal pipelines with stage ID → label mapping.

    Returns:
        {pipeline_id: {"label": str, "stages": {stage_id: stage_label}}}
    """
    data = _get("/crm/v3/pipelines/deals")
    pipelines = {}
    for p in data.get("results", []):
        pid = str(p["id"])
        stages = {}
        for s in p.get("stages", []):
            stages[str(s["id"])] = s["label"]
        pipelines[pid] = {"label": p["label"], "stages": stages}
    return pipelines


def parse_deal(deal: dict, pipelines: dict | None = None) -> dict:
    """Parse a HubSpot deal into a normalized dict for storage."""
    props = deal.get("properties", {})
    associations = deal.get("associations", {})

    # Extract associated IDs
    company_ids = [
        a["id"] for a in associations.get("companies", {}).get("results", [])
    ]
    contact_ids = [
        a["id"] for a in associations.get("contacts", {}).get("results", [])
    ]

    # Resolve stage ID to label (needs pipeline to find correct stage list)
    stage_id = props.get("dealstage") or ""
    pipeline_id = props.get("pipeline") or ""
    stage_label = stage_id
    if pipelines and pipeline_id in pipelines:
        stage_label = pipelines[pipeline_id]["stages"].get(stage_id, stage_id)

    return {
        "deal_id": deal.get("id", ""),
        "deal_name": props.get("dealname"),
        "deal_stage": stage_label,
        "amount": _safe_float(props.get("amount")),
        "create_date": props.get("createdate") or None,
        "close_date": props.get("closedate") or None,
        "owner_id": props.get("hubspot_owner_id"),
        "owner_name": None,  # CX Owner - resolved later from hubspot_owner_id
        "ae_owner_id": props.get("who_closed_the_lead"),  # Account Executive (owner ID)
        "ae_owner_name": None,  # Resolved later from owners dict
        "segment": props.get("segment_v2"),
        "region": props.get("region"),
        "country": props.get("pais"),  # HubSpot "Main Country" deal property
        "users_by_contract": _safe_int(props.get("users_by_contract")),
        "sales_lost_reason": props.get("sales_lost_reason"),
        "industry": props.get("industria_hu"),
        "associated_company_ids": company_ids,
        "associated_contact_ids": contact_ids,
        "properties": props,
    }


# ── Companies ──

def fetch_all_companies() -> list[dict]:
    """Fetch all companies with properties."""
    all_companies = []
    after = None

    while True:
        params = {
            "properties": ",".join(COMPANY_PROPERTIES),
            "limit": 100,
        }
        if after:
            params["after"] = after

        data = _get("/crm/v3/objects/companies", params)
        results = data.get("results", [])
        all_companies.extend(results)
        logger.info(f"Fetched {len(results)} companies (total: {len(all_companies)})")

        paging = data.get("paging", {})
        after = paging.get("next", {}).get("after")
        if not after:
            break

        time.sleep(0.15)

    return all_companies


def parse_company(company: dict) -> dict:
    """Parse a HubSpot company into a normalized dict."""
    props = company.get("properties", {})
    return {
        "company_id": company.get("id", ""),
        "name": props.get("name"),
        "domain": props.get("domain"),
        "industry": props.get("industry"),
        "company_size": props.get("numberofemployees"),
        "segment": props.get("segment"),
        "employee_range": props.get("hs_employee_range"),
        "country": props.get("country"),
        "region": props.get("state"),
        "properties": props,
    }


# ── Contacts ──

def fetch_all_contacts() -> list[dict]:
    """Fetch all contacts with properties and deal associations."""
    all_contacts = []
    after = None

    while True:
        params = {
            "properties": ",".join(CONTACT_PROPERTIES),
            "associations": "deals",
            "limit": 100,
        }
        if after:
            params["after"] = after

        data = _get("/crm/v3/objects/contacts", params)
        results = data.get("results", [])
        all_contacts.extend(results)
        logger.info(f"Fetched {len(results)} contacts (total: {len(all_contacts)})")

        paging = data.get("paging", {})
        after = paging.get("next", {}).get("after")
        if not after:
            break

        time.sleep(0.15)

    return all_contacts


def parse_contact(contact: dict) -> dict:
    """Parse a HubSpot contact into a normalized dict."""
    props = contact.get("properties", {})
    associations = contact.get("associations", {})

    deal_ids = [
        a["id"] for a in associations.get("deals", {}).get("results", [])
    ]

    return {
        "contact_id": contact.get("id", ""),
        "email": props.get("email"),
        "firstname": props.get("firstname"),
        "lastname": props.get("lastname"),
        "company_id": None,  # Resolved via associations
        "associated_deal_ids": deal_ids,
        "properties": props,
    }


def search_contacts_by_email(email: str) -> list[dict]:
    """Search HubSpot contacts by exact email match."""
    body = {
        "filterGroups": [
            {
                "filters": [
                    {
                        "propertyName": "email",
                        "operator": "EQ",
                        "value": email,
                    }
                ]
            }
        ],
        "properties": CONTACT_PROPERTIES,
        "limit": 10,
    }
    data = _post("/crm/v3/objects/contacts/search", body)
    return data.get("results", [])


def search_companies_by_domain(domain: str) -> list[dict]:
    """Search HubSpot companies by domain."""
    body = {
        "filterGroups": [
            {
                "filters": [
                    {
                        "propertyName": "domain",
                        "operator": "EQ",
                        "value": domain,
                    }
                ]
            }
        ],
        "properties": COMPANY_PROPERTIES,
        "limit": 10,
    }
    data = _post("/crm/v3/objects/companies/search", body)
    return data.get("results", [])


def get_deals_for_contact(contact_id: str) -> list[str]:
    """Get deal IDs associated with a contact."""
    data = _get(f"/crm/v3/objects/contacts/{contact_id}/associations/deals")
    return [r["id"] for r in data.get("results", [])]


def get_deals_for_company(company_id: str) -> list[str]:
    """Get deal IDs associated with a company."""
    data = _get(f"/crm/v3/objects/companies/{company_id}/associations/deals")
    return [r["id"] for r in data.get("results", [])]


def batch_read_deals(deal_ids: list[str]) -> list[dict]:
    """Batch read deal details by IDs (max 100 per request)."""
    if not deal_ids:
        return []

    all_deals = []
    for i in range(0, len(deal_ids), 100):
        batch = deal_ids[i:i + 100]
        body = {
            "properties": DEAL_PROPERTIES,
            "inputs": [{"id": did} for did in batch],
        }
        data = _post("/crm/v3/objects/deals/batch/read", body)
        all_deals.extend(data.get("results", []))
        time.sleep(0.15)

    return all_deals


# ── Pipelines & Stages ──

def fetch_deal_pipelines() -> tuple[dict[str, str], dict[str, str]]:
    """Fetch pipeline and stage ID -> label mappings.

    Returns:
        (pipeline_labels, stage_labels) where both are {id: label} dicts.
        Stage IDs are globally unique in HubSpot so a flat dict works.
    """
    data = _get("/crm/v3/pipelines/deals")
    pipeline_labels: dict[str, str] = {}
    stage_labels: dict[str, str] = {}
    for pipeline in data.get("results", []):
        pid = pipeline.get("id", "")
        pipeline_labels[pid] = pipeline.get("label", pid)
        for stage in pipeline.get("stages", []):
            sid = stage.get("id", "")
            stage_labels[sid] = stage.get("label", sid)
    return pipeline_labels, stage_labels


# ── Owners ──

def fetch_owners() -> dict[str, str]:
    """Fetch owner ID -> name mapping."""
    data = _get("/crm/v3/owners", {"limit": 500})
    owners = {}
    for owner in data.get("results", []):
        oid = str(owner.get("id", ""))
        first = owner.get("firstName", "")
        last = owner.get("lastName", "")
        owners[oid] = f"{first} {last}".strip()
    return owners


# ── Helpers ──

def _safe_float(val: Any) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def _safe_int(val: Any) -> int | None:
    if val is None:
        return None
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None
