# Greenlight

Greenlight runs plain-English feature files against a selected web target and records browser evidence for each run.

## Language

**Project**:
A folder of feature files that belong to the same test workspace.
_Avoid_: Suite, repository

**Feature File**:
A Gherkin `.feature` file that describes scenarios Greenlight can run.
_Avoid_: Test file, spec

**Run**:
A recorded execution of one feature file or selected scenarios against a web target.
_Avoid_: Test execution, job

**Environment Profile**:
A named, project-scoped target definition that can be selected before starting a run instead of typing a target manually. It may describe the target and refer to local authentication settings, but it does not contain secrets.
_Avoid_: Environment, target preset, URL profile

**Authentication Reference**:
A non-secret shared label that links an environment profile to authentication settings stored locally on a user's machine.
_Avoid_: Credential, password, token
