import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from server import authority_hostname, local_request_allowed


class RequestPolicyTest(unittest.TestCase):
    def test_accepts_loopback_hosts_and_origins(self) -> None:
        self.assertTrue(local_request_allowed("127.0.0.1:8788", None))
        self.assertTrue(local_request_allowed("localhost:8788", "http://localhost:8788"))
        self.assertTrue(local_request_allowed("[::1]:8788", "https://[::1]:8788"))
        self.assertEqual(authority_hostname("::1"), "::1")

    def test_rejects_non_loopback_hosts_and_origins(self) -> None:
        self.assertFalse(local_request_allowed("voice.example.test", None))
        self.assertFalse(local_request_allowed("127.0.0.1:8788", "https://voice.example.test"))
        self.assertFalse(local_request_allowed(None, None))


if __name__ == "__main__":
    unittest.main()
