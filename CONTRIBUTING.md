# Contributing to Apitomy Flow

Thank you for your interest in contributing to Apitomy Flow! We welcome contributions from the community.

## Ways to Contribute

- **Bug Reports**: Found a bug? Please open an issue with details about the problem and how to reproduce it.
- **Feature Requests**: Have an idea for a new feature? Open an issue to discuss it with the maintainers.
- **Code Contributions**: Submit pull requests for bug fixes or new features.
- **Documentation**: Help improve documentation, examples, or tutorials.
- **Testing**: Help test new features or bug fixes.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally
3. **Create a branch** for your changes: `git checkout -b feature/my-feature`
4. **Make your changes** following our coding standards
5. **Test your changes** thoroughly
6. **Commit your changes** with clear, descriptive commit messages
7. **Push to your fork** and submit a pull request

## Development Setup

See the [README](README.md) for prerequisites and setup instructions.

### Building and Testing

```bash
# Build everything
./build.sh

# Engine only
cd engine && mvn clean install

# UI only
cd ui && npm install && npm run lint && npm test && npm run build

# UI dev server
cd ui && npm run dev
```

## Coding Standards

### Engine (Java)

- Java 25, pure library (no framework dependencies)
- Follow existing code patterns (records, immutable state)
- Run `mvn test` before committing

### UI (React/TypeScript)

- React 19, TypeScript 5.9 with strict mode
- Named exports, `function` declarations (not arrow-const)
- Plain CSS with PatternFly CSS variables
- Run `npm run lint` and `npm test` before committing

## Pull Request Process

1. **Ensure all CI checks pass** (engine build + test, UI lint + build + test)
2. **Keep PRs focused** on a single feature or bug fix
3. **Include a clear description** of what the PR does and why
4. **Reference related issues** in your PR description (e.g., "Fixes #123")
5. **Be responsive** to review feedback and questions

## Commit Message Format

We use conventional commit messages:

- `feat: add new feature`
- `fix: resolve bug in X`
- `docs: update documentation`
- `refactor: restructure code without changing behavior`
- `test: add or update tests`
- `chore: update dependencies or tooling`

Scope is optional but encouraged for clarity: `feat(ui): add node palette`, `fix(engine): handle retry loop`.

## Reporting Bugs

When reporting bugs, please include:

- A clear, descriptive title
- Steps to reproduce the issue
- Expected behavior vs. actual behavior
- Your environment (Java version, Node.js version, OS)
- Relevant logs or error messages

## License

By contributing to Apitomy Flow, you agree that your contributions will be licensed under the Apache License 2.0.

---

Thank you for contributing to Apitomy Flow!
