## [0.1.0](https://github.com/ExaDev/better-auth-api-keys/compare/v0.0.0...v0.1.0) (2026-10-02)

### Features

* **api-keys:** record a key's use only when the host accepts it ([9edf6aa](https://github.com/ExaDev/better-auth-api-keys/commit/9edf6aa30ccb2aff4c3943c868944b36d09b9077))
* **api-keys:** report when an expired key was created ([c39565a](https://github.com/ExaDev/better-auth-api-keys/commit/c39565a560b88857ebcf34689acf17470d1cb42f))

### Bug Fixes

* **api-keys:** point the Workers test entry at the plugin barrel ([d8d9826](https://github.com/ExaDev/better-auth-api-keys/commit/d8d9826414b73f18df79fdcb6c3745e891166366))
* use a changelog preset the release notes writer can render ([5f693b4](https://github.com/ExaDev/better-auth-api-keys/commit/5f693b48da614d02b521c24127d84785f1eba0f4))

### Documentation

* describe the package as a standalone library ([d1b536c](https://github.com/ExaDev/better-auth-api-keys/commit/d1b536c039eb724dcdd56b85351a7bd469417c8b))
* give the real reason a failed release could not open its issue ([bab3732](https://github.com/ExaDev/better-auth-api-keys/commit/bab37323762785f2e1006874be2e44f6f3571bbe))

### Code Refactoring

* meet the current org lint rules ([f94fe2c](https://github.com/ExaDev/better-auth-api-keys/commit/f94fe2c6c403746047b6c509a13dab9d1805f099))

### Tests

* **api-keys:** lint each folder's import boundary in one pass ([3238399](https://github.com/ExaDev/better-auth-api-keys/commit/3238399ac4a811501f3bc6ade8e6d195e5bc952d))
* **api-keys:** lint the given text in CI, not the file on disk ([afd2373](https://github.com/ExaDev/better-auth-api-keys/commit/afd2373190ac7ac9fca8b8aa40cfa9b320896574))
* derive the mutation break threshold from the CI run ([c77c527](https://github.com/ExaDev/better-auth-api-keys/commit/c77c5279ee84a0a76bd0649df60e90977f1e580c))

### Build System

* build, test and lint the package outside the monorepo ([8fad4c9](https://github.com/ExaDev/better-auth-api-keys/commit/8fad4c9400f4a14e22c345ea38c4034947f6f558))
* release to npm with semantic-release, checked by commitlint and husky ([b6871a5](https://github.com/ExaDev/better-auth-api-keys/commit/b6871a538fb81b5a1139eb40dde7275254f0a22c))

### Continuous Integration

* call GitHub's API from the release with the workflow token ([aaa5aab](https://github.com/ExaDev/better-auth-api-keys/commit/aaa5aab04605d535b7a950d29e5d5f25657fcb51))
* check every change, test the peer ranges' ends and release from main ([5c8fbec](https://github.com/ExaDev/better-auth-api-keys/commit/5c8fbec32caa17ecb926f8fc770e8fc35a4598a5))
* move the peers to each end of their ranges with pnpm update ([7f413ce](https://github.com/ExaDev/better-auth-api-keys/commit/7f413ce54edf8bb93b3a5bacfd4205980a589faa))
* run mutation testing on pull requests and daily ([6310d5e](https://github.com/ExaDev/better-auth-api-keys/commit/6310d5eef16c699d6bbca6f281d12aed9a464a8a))

### Chores

* **api-keys:** treat every subpath barrel as a knip entry point ([55639d6](https://github.com/ExaDev/better-auth-api-keys/commit/55639d643620d471a7a3f7979a78f9c3b8aa498c))
