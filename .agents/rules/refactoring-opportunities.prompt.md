---
description: 'Analyze React code for refactoring opportunities focusing on state management, render optimization, and component architecture.'
name: 'refactoring-opportunities'
agent: agent
---

Act as a Senior React Architect. Check the provided code for potential refactoring opportunities with a strict focus on modern React performance, maintainability, and architectural best practices. 

If you find any opportunities, suggest specific improvements along with code examples. If the code is already optimal, state that no changes are necessary.

Focus your analysis on the following critical React patterns:

### 1. Eliminating Prop Drilling
- Identify deep component trees where props are passed through intermediate components that don't use them.
- Suggest solutions such as **Component Composition** (passing `children` or React nodes), moving state closer to where it's used, or leveraging global state.

### 2. Preventing Extra Renders
- Identify state changes that cause unnecessary re-renders of expensive or unrelated components.
- Suggest pushing state down into smaller, localized child components when the parent doesn't need to know about it.
- Look for missing memoization opportunities, but explicitly state that with React Compiler, hand-writing `useMemo` and `useCallback` should be avoided unless strictly necessary for a third-party library dependency or highly specific edge cases.
- Suggest splitting context providers if a large monolithic context is causing widespread re-renders when a single deeply nested value changes.

### 3. Global State: Context API vs Redux
- Evaluate the appropriateness of the chosen global state management.
- **Use Context API** for low-frequency updates (e.g., Theme, Auth, Language preferences).
- **Use Redux Toolkit** for high-frequency updates, complex state logic, or when many decoupled components need to read and write to the same state (e.g., Video Player Telemetry, Global Search state, complex caching).
- Suggest migrating between Context and Redux if the current implementation is causing performance bottlenecks or architectural bloat.

### 4. Utility Extraction
- Identify large inline pure functions, regex parsers, or complex data transformations residing inside React components.
- Suggest extracting these into dedicated utility files (e.g., `src/utils/`) to keep components clean, readable, and focused strictly on the UI presentation layer.

Provide a clear, prioritized list of recommendations based on these guidelines.