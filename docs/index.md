---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "Zo Co-browse"
  text: "AI that sees your page and acts through your browser"
  tagline: A Chrome extension that connects your browser to Zo Computer. Zo reads the page DOM, uses its full toolchain — files, DuckDB, web search, skills, integrations — and returns structured browser actions.
  image:
    src: /logo.png
    alt: Zo Co-browse
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/CCAgentOrg/zo-cobrowse

features:
  - icon: 🤖
    title: True co-browsing
    details: Zo is the backend — it sees your current page's DOM, ties it to your full toolchain (datasets, skills, automations), and returns actions that execute in your browser.
  - icon: 🎯
    title: Tiered page context
    details: Four capture tiers tune how much of the page Zo sees — URL-only, text, elements with selectors, or a full screenshot — so every request is cheap and precise.
  - icon: 🚀
    title: Hardened streaming
    details: Token-by-token responses over SSE with per-query session isolation, safe retries, and a live progress indicator. No silent data loss.
  - icon: 🧭
    title: Modes & bang commands
    details: Built-in modes (Co-browse, Summarize, Extract, Research…) plus quick '!' commands. Read-only questions answer in prose, not JSON.
---
