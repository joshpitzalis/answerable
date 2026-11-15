# Answerable

Surfaces questions asked in library communities that the owner has not answered yet but could answer from something they have already written.

## Language

**Project**: A library community the owner answers questions for, such as Effect or XState. It owns one Discord server, the Channels read within it, the owner's display name there, and its own Posts. _Avoid_: Tab, community, source, server

**Channel**: A single Discord channel inside a Project's server that questions are read from. A Project has one or more. _Avoid_: Room, feed

**Harvest**: One pass over a Project's Channels that reads messages not seen before and keeps the questions the owner has not answered but could answer from a Post. _Avoid_: Sync, scrape, poll, fetch

**Post**: Something the owner has already written about a Project's library. Posts are the evidence a question is checked against, and belong to exactly one Project. _Avoid_: Article, corpus entry, blog
