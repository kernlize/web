Feature: Web Crypto outside a secure context
  Served over plain HTTP from an onion or overlay network address, the page is
  not a secure context: the browser keeps crypto.getRandomValues but withholds
  crypto.randomUUID and crypto.subtle. The shell fills them in (D-024), and its
  results match the browser's own Web Crypto byte for byte.

  Scenario: a secure context is left alone
    Given a scope with the platform's Web Crypto
    When the shell installs the crypto fallback
    Then the fallback added nothing
    And the scope still has the platform's Web Crypto

  Scenario: an insecure context gains randomUUID and subtle
    Given a scope with only getRandomValues
    When the shell installs the crypto fallback
    Then the fallback added randomUUID and subtle
    And the scope's randomUUID returns version 4 UUIDs

  Scenario Outline: a scope that cannot be helped is left alone
    Given a scope <shape>
    When the shell installs the crypto fallback
    Then the fallback added nothing

    Examples:
      | shape                          |
      | without crypto                 |
      | with crypto but no randomness  |

  Scenario: an applet frame gains randomUUID before its own scripts
    Given a scope with only getRandomValues
    When the applet-side randomUUID script runs in that scope
    Then the scope's randomUUID returns version 4 UUIDs

  Scenario Outline: the fallback matches the platform
    Then the fallback's <operation> matches the platform's

    Examples:
      | operation              |
      | SHA-1 digest           |
      | SHA-256 digest         |
      | SHA-384 digest         |
      | SHA-512 digest         |
      | HMAC SHA-256 signature |
      | HKDF SHA-256 bits      |
      | AES-GCM ciphertext     |
      | AES-GCM without aad    |
      | AES-CBC ciphertext     |
      | X25519 shared secret   |
      | Ed25519 signature      |
      | Ed25519 key export     |
      | X25519 key export      |

  Scenario Outline: the fallback interoperates with the platform
    Then <check>

    Examples:
      | check                                                     |
      | the platform verifies an Ed25519 signature from the fallback |
      | the fallback verifies an Ed25519 signature from the platform |
      | the fallback verifies its own HMAC and rejects a forgery     |
      | the platform decrypts AES-GCM from the fallback              |
      | the fallback decrypts AES-CBC from the platform              |
      | the fallback round-trips generated keys                      |

  Scenario Outline: the fallback rejects what it does not support
    When the fallback is asked to <request>
    Then it rejects with a "<error>"

    Examples:
      | request                                    | error              |
      | digest with MD5                            | NotSupportedError  |
      | digest a number                            | DataError          |
      | import an RSA key                          | NotSupportedError  |
      | import an X25519 spki key                  | NotSupportedError  |
      | import a short Ed25519 key                 | DataError          |
      | import a truncated Ed25519 pkcs8 key       | DataError          |
      | import an X25519 pkcs8 key as Ed25519      | DataError          |
      | import an RSA jwk as Ed25519               | DataError          |
      | import an X25519 jwk as Ed25519            | DataError          |
      | import an empty OKP jwk                    | DataError          |
      | import a 10-byte AES key                   | DataError          |
      | import an AES jwk without k                | DataError          |
      | import an RSA jwk as AES                   | NotSupportedError  |
      | import an AES pkcs8 key                    | NotSupportedError  |
      | import an HMAC key without a hash          | NotSupportedError  |
      | generate an RSA key                        | NotSupportedError  |
      | generate an HMAC key without a hash        | NotSupportedError  |
      | export a non-extractable key               | InvalidAccessError |
      | export a secret key as pkcs8               | NotSupportedError  |
      | export a private Ed25519 key as raw        | InvalidAccessError |
      | sign with a platform key                   | InvalidAccessError |
      | sign HMAC with an AES key                  | InvalidAccessError |
      | sign with an Ed25519 public key            | NotSupportedError  |
      | verify with an Ed25519 private key         | NotSupportedError  |
      | encrypt with AES-CTR                       | NotSupportedError  |
      | encrypt AES-GCM without an iv              | DataError          |
      | encrypt AES-GCM with a 96-bit tag          | NotSupportedError  |
      | decrypt tampered AES-GCM                   | OperationError     |
      | derive bits without parameters             | NotSupportedError  |
      | derive HKDF bits without a length          | NotSupportedError  |
      | derive bits from an HMAC key               | NotSupportedError  |
      | derive a key                               | NotSupportedError  |
