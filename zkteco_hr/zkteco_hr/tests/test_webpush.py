import unittest

from zkteco_hr.webpush import subscription_name


class TestWebPush(unittest.TestCase):
    def test_subscription_name_is_deterministic_and_idempotent(self):
        endpoint = "https://fcm.googleapis.com/fcm/send/abc123"
        self.assertEqual(subscription_name(endpoint), subscription_name(endpoint))
        self.assertEqual(len(subscription_name(endpoint)), 40)

    def test_subscription_name_differs_per_endpoint(self):
        self.assertNotEqual(
            subscription_name("https://push.example/a"),
            subscription_name("https://push.example/b"),
        )
