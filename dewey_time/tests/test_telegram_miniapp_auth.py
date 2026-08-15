import contextlib
import hashlib
import hmac
import json
import time
import unittest
from unittest.mock import patch
from urllib.parse import urlencode

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.telegram import miniapp_auth  # noqa: E402

BOT_TOKEN = "123456:TEST-TOKEN"


class Rejected(Exception):
    """Marker raised in place of _reject().

    Load-bearing. assertRaises(Exception) cannot tell OUR guard firing from an
    incidental blow-up further down: with the hash check removed,
    hmac.compare_digest(expected, None) raises TypeError, and a test that only
    asserts "something raised" stays green. Every guard test below asserts
    THIS type, so only a real rejection satisfies it.
    """


def sign(fields: dict, token: str = BOT_TOKEN) -> str:
    """Build a correctly signed initData string, the way Telegram does."""
    check = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    digest = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode({**fields, "hash": digest})


def valid_fields(user_id=55501, auth_date=None):
    return {
        "auth_date": str(int(auth_date if auth_date is not None else time.time())),
        "query_id": "AAF",
        "user": json.dumps({"id": user_id, "first_name": "Test"}),
    }


@contextlib.contextmanager
def only_the_guard_can_raise(employee="HR-EMP-00001"):
    """Patch the bot token AND make the binding succeed unconditionally.

    Load-bearing, not convenience. `employee_for_telegram_user` refuses an
    unknown account by raising, so a rejection test that leaves it unpatched
    passes whether or not the guard under test ran at all -- the binding's own
    refusal masks every earlier check. Mutation testing proved it: deleting the
    signature check, the freshness check, and the absent-hash branch each left
    the whole suite green.

    With the binding forced to succeed, the ONLY thing that can raise is the
    guard being tested.
    """
    with patch.object(miniapp_auth.transport, "bot_token", return_value=BOT_TOKEN), \
         patch.object(miniapp_auth, "_reject", side_effect=Rejected), \
         patch.object(miniapp_auth.binding, "employee_for_telegram_user",
                      return_value=employee) as resolve:
        yield resolve


class TestSignature(unittest.TestCase):
    def test_a_correctly_signed_payload_resolves_to_its_employee(self):
        with only_the_guard_can_raise() as resolve:
            self.assertEqual(
                miniapp_auth.employee_from_init_data(sign(valid_fields())),
                "HR-EMP-00001",
            )
        self.assertEqual(resolve.call_args[0][0], "55501")

    def test_the_resolved_id_is_the_one_that_was_signed(self):
        # A distinct id, so hardcoding or defaulting the lookup argument
        # cannot pass. The test above alone left that mutation alive.
        with only_the_guard_can_raise() as resolve:
            miniapp_auth.employee_from_init_data(sign(valid_fields(user_id=7788990)))
        self.assertEqual(resolve.call_args[0][0], "7788990")

    def test_a_tampered_field_is_rejected(self):
        forged = sign(valid_fields(user_id=55501)).replace("55501", "99999")
        with only_the_guard_can_raise():
            with self.assertRaises(Rejected):
                miniapp_auth.employee_from_init_data(forged)

    def test_a_payload_signed_with_another_token_is_rejected(self):
        with only_the_guard_can_raise():
            with self.assertRaises(Rejected):
                miniapp_auth.employee_from_init_data(sign(valid_fields(), token="999:OTHER"))

    def test_an_absent_hash_is_rejected_not_skipped(self):
        # The classic bypass shape. Missing must reject, never fall through.
        with only_the_guard_can_raise():
            with self.assertRaises(Rejected):
                miniapp_auth.employee_from_init_data(urlencode(valid_fields()))

    def test_an_empty_init_data_is_rejected(self):
        with only_the_guard_can_raise():
            with self.assertRaises(Rejected):
                miniapp_auth.employee_from_init_data("")


class TestRealWorldPayloadShape(unittest.TestCase):
    """Guards against a whole class of failure the other tests cannot see.

    Every fixture above is a payload I invented. Real initData carries fields
    those do not -- notably `signature`, which Telegram added for third-party
    Ed25519 validation and now sends on real launches.

    Per Telegram's spec the HMAC data-check-string is "a chain of all received
    fields, sorted alphabetically" with only `hash` removed; `signature` is
    excluded solely from the separate Ed25519 path. So `signature` MUST stay in
    the HMAC input. Had this been implemented the other way, every real launch
    would have failed authentication while the entire suite stayed green,
    because no fixture emitted the field.
    """

    def test_a_payload_carrying_signature_still_validates(self):
        fields = valid_fields()
        fields["signature"] = "gpUmvpwCzUmYqCLNZ2f6nHy2xt9tvJm9Y8FLZ0Kk"
        fields["chat_type"] = "sender"
        fields["chat_instance"] = "-3788442525382237900"
        with only_the_guard_can_raise() as resolve:
            self.assertEqual(
                miniapp_auth.employee_from_init_data(sign(fields)), "HR-EMP-00001"
            )
        self.assertEqual(resolve.call_args[0][0], "55501")

    def test_tampering_with_signature_invalidates_the_payload(self):
        # The corollary: because `signature` is inside the HMAC input, editing
        # it breaks the hash. If it were excluded this would silently pass.
        fields = valid_fields()
        fields["signature"] = "original"
        signed = sign(fields).replace("signature=original", "signature=tampered")
        with only_the_guard_can_raise():
            with self.assertRaises(Rejected):
                miniapp_auth.employee_from_init_data(signed)

    def test_an_unknown_future_field_does_not_break_validation(self):
        # Telegram has added fields before and will again. Anything new is
        # covered by the hash and must simply flow through the sort.
        fields = valid_fields()
        fields["some_field_telegram_adds_in_2027"] = "whatever"
        with only_the_guard_can_raise():
            self.assertEqual(
                miniapp_auth.employee_from_init_data(sign(fields)), "HR-EMP-00001"
            )


class TestFreshness(unittest.TestCase):
    def test_stale_init_data_is_rejected(self):
        # Without this, captured initData is a permanent credential. It is the
        # one failure that is invisible when missing: the app works, and every
        # other test still passes.
        old = time.time() - miniapp_auth.MAX_AUTH_AGE_SECONDS - 60
        with only_the_guard_can_raise():
            with self.assertRaises(Rejected):
                miniapp_auth.employee_from_init_data(sign(valid_fields(auth_date=old)))

    def test_recent_init_data_is_accepted(self):
        with only_the_guard_can_raise():
            self.assertEqual(
                miniapp_auth.employee_from_init_data(
                    sign(valid_fields(auth_date=time.time() - 60))
                ),
                "HR-EMP-00001",
            )

    def test_a_missing_auth_date_is_rejected(self):
        fields = valid_fields()
        del fields["auth_date"]
        with only_the_guard_can_raise():
            with self.assertRaises(Rejected):
                miniapp_auth.employee_from_init_data(sign(fields))


class TestUserField(unittest.TestCase):
    def test_a_payload_with_no_user_is_rejected(self):
        fields = valid_fields()
        del fields["user"]
        with only_the_guard_can_raise():
            with self.assertRaises(Rejected):
                miniapp_auth.employee_from_init_data(sign(fields))

    def test_unparseable_user_json_is_rejected(self):
        fields = valid_fields()
        fields["user"] = "{not json"
        with only_the_guard_can_raise():
            with self.assertRaises(Rejected):
                miniapp_auth.employee_from_init_data(sign(fields))

    def test_the_binding_still_decides_whose_record_it_is(self):
        # The one test that deliberately lets the binding refuse: a valid
        # signature proves the id came from Telegram and authorizes nobody.
        with patch.object(miniapp_auth.transport, "bot_token", return_value=BOT_TOKEN), \
             patch.object(miniapp_auth.binding, "employee_for_telegram_user",
                          side_effect=Exception("Not permitted")):
            # Plain Exception, not Rejected: _reject is deliberately NOT
            # patched here, because the binding itself is the thing refusing.
            with self.assertRaises(Exception):
                miniapp_auth.employee_from_init_data(sign(valid_fields()))
