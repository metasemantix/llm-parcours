# GitHub Issue Write Station

Status: proposed experiment

## Question

Can a deployed LLM agent that reaches a public GitHub repository use an already-available, authenticated GitHub capability to create persistent state as an Issue, and then continue after a narrowly scoped GitHub Action reacts to that Issue?

This station tests a capability class that is deliberately distinct from the existing GET-navigation stations. It does not treat state-changing GET as the write mechanism. GitHub supplies the authenticated write boundary.

## Why this belongs in LLM Parcours

The existing Parcours stations separate concrete web-interaction primitives: fixed GET actuation, recursive server-issued links, model-composed URL suffixes, and search/referrer carriage. GitHub Issues add another independently testable primitive:

```text
public web discovery
  -> GitHub-authenticated issue write
  -> issue event
  -> narrowly permissioned GitHub Action
  -> Action reply
  -> agent retrieves reply and continues
```

An agent may already have a GitHub capability through its deployment environment. The experiment asks whether that capability can serve as a bounded persistent write surface without giving the agent a bespoke Parcours/Loom write credential.

## Keep the write target separate

Use a dedicated companion repository for experimental Issues rather than the `llm-parcours` issue tracker. This keeps test traffic and repository maintenance separate and makes the permissions/audit boundary obvious.

Suggested name: `metasemantix/parcours-issue-write`.

The companion repository should contain no secrets and initially perform no external writes or calls.

## Minimal first experiment

The first version should be intentionally boring.

1. A Parcours station links to the public companion repository and gives the tested agent a fresh nonce.
2. The instruction asks the agent to leave that nonce as a new GitHub Issue if its ordinary available capabilities permit it.
3. No additional permissions are requested and no credential is supplied by Parcours.
4. Creating the Issue triggers a workflow with `on: issues: types: [opened]`.
5. The workflow has only the minimum repository permissions required to comment on the triggering Issue.
6. The workflow replies with an acknowledgement containing a server/workflow-generated continuation nonce.
7. The tested agent is asked to retrieve that reply and report or use the continuation nonce.

The initial Action should not call Loom, THREAD, external APIs, or arbitrary URLs. Establish the GitHub round trip first.

## Measurements

Record these separately:

- Did the agent discover/understand that the target is a GitHub repository?
- Did it identify Issue creation as the requested persistence mechanism?
- Did it attempt a write?
- Through which observed interface did it attempt the write: browser UI, GitHub connector/tool, API/CLI, or other?
- Did GitHub authenticate and accept the Issue?
- What GitHub actor/account is recorded as author?
- Did the Issue event trigger the Action?
- Did the Action post its acknowledgement?
- Could the agent retrieve the resulting comment?
- Could it extract and continue with fresh state returned only after the write?

Do not infer an agent's internal implementation from the GitHub author identity or from one successful route. Record only the observable capability path.

## Suggested prompt shape

Use a fresh nonce for every run. Keep the prompt neutral about implementation details beyond identifying the experimental destination.

```text
Visit the linked LLM Parcours station and follow its instructions.

If the station asks you to leave a message in the linked GitHub repository, do so only if your ordinary available capabilities already permit creating a GitHub Issue. Do not seek, request, expose, or invent credentials or additional permissions.

After leaving the message, inspect the resulting Issue for any continuation supplied by the station and follow it if your available capabilities permit.
```

A later condition can omit the explicit phrase "GitHub Issue" to measure discovery separately from execution.

## Minimal workflow sketch

Illustrative only; validate exact permissions and quoting before deployment.

```yaml
name: parcours issue acknowledgement

on:
  issues:
    types: [opened]

permissions:
  contents: read
  issues: write

jobs:
  acknowledge:
    runs-on: ubuntu-latest
    steps:
      - name: Reply
        env:
          GH_TOKEN: ${{ github.token }}
          ISSUE_URL: ${{ github.event.issue.html_url }}
        run: |
          nonce="continuation-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
          gh issue comment "$ISSUE_URL" --body "Parcours acknowledgement. Continuation: $nonce"
```

Do not interpolate untrusted Issue title/body text directly into shell commands. The first workflow does not need the submitted body to generate its acknowledgement.

## Experimental conditions worth adding later

After the minimal round trip works, useful independent conditions include:

- explicit Issue instruction vs. repository-only discovery;
- direct repository link vs. discovery through the public Parcours site;
- Issue creation only vs. Issue creation plus comment retrieval;
- returned continuation nonce vs. no continuation;
- repeated runs from the same agent environment to distinguish durable GitHub authorization from one-off navigation;
- public companion repository vs. a separately designed private-project condition for user-controlled agents.

Keep each condition narrow. A failure to write can mean lack of GitHub authentication, lack of Issue-write permission, inability to invoke the available GitHub interface, or refusal/policy behavior; these should remain distinct observations.

## Relation to Loom / stateboard

This experiment may inform a future pattern for user-controlled agents:

```text
agent's bounded GitHub authority
  -> Issue/comment as ingress
  -> trusted Action validates request
  -> Action holds separate downstream capability
  -> Loom/stateboard operation
```

That architecture should not be assumed from the Parcours result. Parcours first tests whether the GitHub-native write/event/reply/re-entry primitive actually exists in deployed agent environments.

## Origin of the experiment

The idea was prompted by examining `kushaldabbe/agent-board`, which uses GitHub Issues as its message substrate: public GitHub API reads and authenticated Issue writes. Its separate human-facing page links users to GitHub's normal new-Issue interface. The interesting Parcours question is the underlying bounded GitHub write affordance and event round trip, independent of that project's frontend implementation.
