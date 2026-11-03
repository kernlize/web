Feature: Accounts and signing
  Keys live only inside applesauce signer instances. The shell persists
  accounts, never a plaintext key, and hands kehto a signer that cannot leak
  the account behind it.

  Scenario: a fresh manager has no accounts and nothing active
    Given kernl accounts over empty storage
    Then there are 0 accounts and no active account
    And the auth hooks report no user and no signer

  Scenario: a password account is persisted along with the active id
    Given kernl accounts over empty storage
    When the shell adds a password account named "alice" and makes it active
    Then storage key "kernl:accounts:v1" lists 1 accounts of type "ncryptsec"
    And storage key "kernl:active-account:v1" names the active account
    When the shell clears the active account
    Then storage has no key "kernl:active-account:v1"

  Scenario: accounts and the active choice are restored on the next boot
    Given kernl accounts over empty storage
    And the shell adds a password account named "alice" and makes it active
    When kernl accounts are created again over the same storage
    Then there are 1 accounts and the active account is named "alice"

  Scenario: an active id that no longer matches an account is ignored
    Given storage key "kernl:active-account:v1" holding '"ghost"'
    And kernl accounts over that storage
    Then there are 0 accounts and no active account

  Scenario: a plaintext key account is refused
    Given kernl accounts over empty storage
    When the shell adds a private key account
    Then the shell refused with "denied:plaintext-key-persistence"
    And there are 0 accounts and no active account

  Scenario: plaintext key entries found in storage are dropped on restore
    Given storage key "kernl:accounts:v1" holding a serialised private key account
    And kernl accounts over that storage
    Then there are 0 accounts and no active account

  Scenario: a read-only account shows an identity but yields no signer
    Given kernl accounts over empty storage
    When the shell adds a read-only account and makes it active
    Then the auth hooks report the active pubkey
    And the auth hooks report no signer
    And the account is read-only

  Scenario: an unlocked password account signs through the wrapped signer
    Given kernl accounts over empty storage
    When the shell adds a password account named "alice" and makes it active
    Then the auth hooks report the active pubkey
    And the wrapped signer signs a kind 1 event for the active pubkey
    And the wrapped signer exposes nip04 and nip44
    And the account is not read-only

  Scenario: a signer without encryption namespaces is wrapped without them
    When the shell wraps a bare signing account
    Then the wrapped signer has no nip04 and no nip44
