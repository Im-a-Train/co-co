# ADR 0005: Data zones and use of AI

- Status: accepted (guard rails; concrete AI features need their own ADRs)
- Date: 2026-11-07

## Context

Later milestones may use AI (LLMs) to help coaches, e.g.:

- reviewing a camp programme against J+S requirements;
- summarising activities;
- drafting feedback.

Camps contain data of very different sensitivity. Some of it concerns minors, and MiData, the PBS
member database, holds personal data that is protected by the Swiss FADP/DSG and by PBS rules. We need
a clear rule for which data may ever leave the device towards an AI provider.

## Decision

Every data field co-co handles belongs to one of three zones:

| Zone | Examples | AI use |
| --- | --- | --- |
| **Green**: programme content without personal data | Camp title, motto, periods/dates, activity titles, categories, programme texts, J+S block types, safety concepts written as generic text | Allowed, once the user has explicitly opted in for the action. The user sees what is sent. |
| **Yellow**: personal data of adult leaders, or free text that may contain names | Leader names and nicknames, e-mail addresses, responsibilities, comments, free text written by leaders | Not sent by default. Allowed only after local pseudonymisation (names replaced by placeholders) **and** an explicit per-action confirmation. |
| **Red**: sensitive or protected data | Anything from **MiData** or **NDS** (J+S national database: participant lists, AHV numbers, birth dates, addresses, qualifications); participant data; health, allergy or medication information; emergency contacts; authentication data (tokens, cookies, passwords) | **Never** sent to any AI or other third-party service. No exceptions, no opt-in. |

Rules:

1. **MiData and NDS data are always red.** co-co never passes them to an AI model, even when the
   coach has access.
   - The MiData OAuth login only establishes the eCamp session. co-co does not request MiData person
     data for AI use.
2. Authentication material (JWT parts, refresh token, passwords) is red everywhere:
   - never sent to the frontend, to logs or to AI;
   - spike reports contain cookie **names** only.
3. Any AI integration has to:
   - run only on explicit user action, with a preview of the exact payload;
   - name the provider and its data-processing terms (prefer providers with Swiss/EU processing and
     no training on inputs);
   - classify every field it sends by zone in code. Unclassified fields count as red.
4. M0 contains **no AI functionality**.

## Consequences

- AI features are limited to programme-quality help, which is co-co's core value. Anything about
  participants stays manual.
- The data model in code needs a zone annotation per field, and tests that check that only
  green/yellow-after-pseudonymisation data reaches an AI request builder.
- Future data sources (MiData API, NDS exports) default to red. Changing that needs a new ADR.
