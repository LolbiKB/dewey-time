"""ZKTeco finger indexes, as slugs the Mini App can translate.

A device numbers fingers 0-9, inwards from the left little finger to the left
thumb and then outwards from the right thumb. That integer is meaningless to an
employee and untranslatable -- "FID 6" is the same six characters in Khmer -- so
it is turned into a slug HERE, once, on the server. The Mini App turns a slug
into words.

THE MAPPING IS UNVERIFIED AGAINST A REAL DEVICE. It is the widely-used ZKTeco
ordering, but nothing in this repo confirms it and no data exercises it yet: the
bridge collapses templates to a count before Frappe ever sees them
(frappe-merge.ts:70). Check it against a live enrolment before the bridge side
ships, and correct it here -- being able to correct it in ONE place, in one
language, is the entire reason this mapping is not done in TypeScript.

frappe-free on purpose: no bench behind it, so its tests run in milliseconds and
any module may import it.
"""

from __future__ import annotations

#: FID -> slug. Ten entries, no gaps.
FINGER_SLUGS = {
    0: "left_little",
    1: "left_ring",
    2: "left_middle",
    3: "left_index",
    4: "left_thumb",
    5: "right_thumb",
    6: "right_index",
    7: "right_middle",
    8: "right_ring",
    9: "right_little",
}

#: Anything outside 0-9, or unparseable.
#:
#: A FALLBACK, never a drop. The client shows finger names only when their count
#: equals `fingerprint_count`, so silently dropping one strange value would
#: demote an otherwise correct list back to a bare number.
UNKNOWN_SLUG = "other_finger"


def slug_for(fid) -> str:
    """One device slot as a slug. Never raises."""
    try:
        return FINGER_SLUGS[int(fid)]
    except (TypeError, ValueError, KeyError):
        return UNKNOWN_SLUG


def ids_from_field(value) -> list[int]:
    """Parse the stored "3,6" into [3, 6]. Junk entries are skipped.

    Order is preserved rather than re-sorted: `field_from_ids` already sorts on
    the way in, and sorting again here would hide a writer that did not.
    """
    ids = []
    for part in str(value or "").split(","):
        part = part.strip()
        if not part:
            continue
        try:
            ids.append(int(part))
        except ValueError:
            continue
    return ids


def normalize_ids(value) -> list[int]:
    """A wire value -- a list of ints, or a "3,6" string -- sorted and deduped.

    Both shapes are accepted because the bridge's payload is not settled: it
    sends neither today, and a future version could reasonably send either.
    """
    if isinstance(value, str):
        value = ids_from_field(value)
    seen = set()
    for item in value or []:
        try:
            seen.add(int(item))
        except (TypeError, ValueError):
            continue
    return sorted(seen)


def field_from_ids(value) -> str:
    """The storage form: "3,6", sorted and deduped, or "" for nothing."""
    return ",".join(str(i) for i in normalize_ids(value))
