Feature: kernl's preset
  kernl.run composes the kernel with one list of modules (D-068). The preset is that list, so a host
  that wants kernl's own shell names one thing, and a host that wants less composes modules itself.

  Scenario: The preset names kernl.run's modules in the order they set up
    When a host asks for kernl's preset
    Then the preset names the modules "theme, profiles, people, social, messaging, directory, mailboxes, files, settings, catalog, keys, intents, bridges, downloads, multiplayer, cache"

