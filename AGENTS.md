# Agent Rules

* HARD RULE: Do not add or modify unit tests, integration tests, end-to-end tests, or `.test` files unless the user explicitly asks for tests. Validate through the UI or existing non-test workflows instead.
* Always validate changes through the UI when possible using a QA account. Check docs, skills, and scripts for existing auto-login or QA workflows before creating new ones.
* If you create a new QA workflow, auto-login method, test account, or development shortcut, document it in this file.
* Never use Playwright for UI testing or inspection. Prefer Browser, Helium, then Chrome.
* Always speak in English.
