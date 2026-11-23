Feature: Floor: keys stay inside signers, whatever modules are loaded
  Keys live only inside applesauce signer instances. The shell never writes a
  plaintext key down, and an applet is never handed one. Modules sign through
  the shell's consent, never with a signer of their own (SOUL §1, D-061).

  Scenario: a plaintext key account is refused
    Given kernl accounts over empty storage
    When the shell adds a private key account
    Then the shell refused with "denied:plaintext-key-persistence"
    And there are 0 accounts and no active account

  Scenario: plaintext key entries found in storage are dropped on restore
    Given storage key "kernl:accounts:v1" holding a serialised private key account
    And kernl accounts over that storage
    Then there are 0 accounts and no active account

  Scenario: a throwaway identity signs and is never written down
    Given kernl accounts over empty storage
    When the shell adds a throwaway identity and makes it active
    Then the wrapped signer signs a kind 1 event for the active pubkey
    And storage key "kernl:accounts:v1" lists 0 accounts of type "throwaway"
