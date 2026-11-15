# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The owner: someone who writes about a library (Effect, XState) and answers questions in that library's Discord community. Today that is one person, the author of this repo. The product is built for them first and is meant to open up later to other writers and educators who answer in library communities.

Their situation: questions arrive across several Channels faster than anyone can read them, and many could be answered from something the owner has already written. Their job is to find those questions and reply without reading every Channel.

## Product Purpose

Answerable surfaces questions asked in library communities that the owner has not answered yet but could answer from a Post they have already written, and gives the owner a drafted reply to review.

Success means two things:

- The owner builds reputation in the community by being reliably, visibly helpful.
- The owner learns what to write next: questions that recur or that no Post covers reveal gaps.

## Positioning

Every surfaced question is checked against the owner's own Posts. Answerable does not answer from general knowledge; it only shows questions the owner's existing writing can answer, so each reply is grounded in something they wrote.

## Operating Context

- Questions are read from Discord. A Project owns one Discord server, the Channels read within it, the owner's display name there, and its own Posts.
- A Harvest is one pass over a Project's Channels that reads unseen messages and keeps questions the owner has not answered but could answer from a Post.
- The owner reviews a drafted reply, edits it, and sends it in Discord. Surfaced questions deep-link to the Discord message.

## Capabilities and Constraints

- Terminology is fixed by `GLOSSARY.md`: Project, Channel, Harvest, Post. Use these words in UI copy; avoid the listed alternatives (tab, community, sync, scrape, article, and so on).
- Built today: Harvest pipeline, question judging against Posts, a table of surfaced questions with Discord deep links.
- Not built yet: the drafted reply. It is the confirmed intended workflow, not a shipped feature.
- Questions load in the browser after first paint (see `docs/adr/0001-xstate-orchestrates-effect-services.md`).
- UI is built with Astryx components and tokens; see `AGENTS.md` for the rules.
- Open decision: how and when other owners get access (accounts, onboarding, multi-owner Projects).
- Open decision: how "what to write next" is shown to the owner.

## Brand Commitments

- Name: Answerable.

## Evidence on Hand

- Anonymized Discord message fixtures: `src/features/question-finder/services/_fixtures/messages.json`.
- No testimonials, customers, usage numbers, or pricing exist. Do not fabricate them.

## Product Principles

1. Grounded in the owner's writing. A question appears only when a Post can answer it.
2. The owner sends the reply. Answerable drafts; a person reviews and posts.
3. Triage over reading. The owner should never need to read a whole Channel.
4. Unanswerable questions are signal. Gaps in the Posts are worth showing, not hiding.
5. One owner first. Do not add multi-user machinery before it is decided.
