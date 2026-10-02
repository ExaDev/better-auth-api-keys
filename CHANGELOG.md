## [0.2.0](https://github.com/ExaDev/better-auth-api-keys/compare/v0.1.0...v0.2.0) (2026-10-02)

### Features

* **api-keys:** allow a system principal's key with no expiry when the host opts in ([022e116](https://github.com/ExaDev/better-auth-api-keys/commit/022e116a5a1101a9a01590a3b8268ac4a084c859))
* **api-keys:** bound a key's recorded creator to the length of an email address ([39fb4e2](https://github.com/ExaDev/better-auth-api-keys/commit/39fb4e274ac23a713f3fbd627cbea9ab2afee182))
* **api-keys:** let a system principal own API keys ([2178d89](https://github.com/ExaDev/better-auth-api-keys/commit/2178d89f3dc0237dc9a089fcf7175d185a925ebb))
* **api-keys:** list a malformed row by id instead of failing the list ([210c646](https://github.com/ExaDev/better-auth-api-keys/commit/210c6466c105f3d2d05e13993b020cc418bf6117))
* **api-keys:** record who created a key ([6107c33](https://github.com/ExaDev/better-auth-api-keys/commit/6107c339639ffc95ed299bd15288eb418c413093))
* **api-keys:** report a key's owner only as owner ([cf37830](https://github.com/ExaDev/better-auth-api-keys/commit/cf378307b84c0673d4537bd0bfcff0be48a5dc7f))
* **api-keys:** require every owner to name its kind ([bc80bfb](https://github.com/ExaDev/better-auth-api-keys/commit/bc80bfbed8f0452d7f368b05364a3fdd1111d391))

### Documentation

* list every change a host makes to upgrade from 0.1.0 ([81a4d4e](https://github.com/ExaDev/better-auth-api-keys/commit/81a4d4e2b6c22a86b5493850cfe989d92e0b6b22))
* list the malformed listing among the upgrade changes ([9869b9a](https://github.com/ExaDev/better-auth-api-keys/commit/9869b9a55cf3b9378ac053180f3fcb5d120395d2))
* run the 0.1.0 migration as one transaction, before the new code ([7e726f8](https://github.com/ExaDev/better-auth-api-keys/commit/7e726f8f772d898419cb4b63c6083db74c4a6bfd))
* say when orphaned keys stop the migration, and test their deletion ([2153a74](https://github.com/ExaDev/better-auth-api-keys/commit/2153a74d50652759061b720676927c8ebd427e24))

### Code Refactoring

* **api-keys:** call an unreadable listed row corrupt, not malformed ([ce429a0](https://github.com/ExaDev/better-auth-api-keys/commit/ce429a01b13f2c65b807b2820e950156778c0f3c))

### Tests

* catch a migration that copies one column into another ([146dc70](https://github.com/ExaDev/better-auth-api-keys/commit/146dc70939270e595e4a5d626fb936f00a0a5d43))
* check the migrated table in the database, not the Drizzle declaration ([fbb9112](https://github.com/ExaDev/better-auth-api-keys/commit/fbb9112bfb36a8ed6c23e8b14b8ff48870bc1733))
* compare key_hash's uniqueness when checking the migrated table ([2db5b5b](https://github.com/ExaDev/better-auth-api-keys/commit/2db5b5b1eaf6698be76a983984028844db3a70dd))
* list a stored key whose creator is over the length limit as corrupt ([b0f8a3d](https://github.com/ExaDev/better-auth-api-keys/commit/b0f8a3d2707acf3fb2503f7fe74a419c12a39562))
* pin the order of malformed rows in a listed owner's keys ([5a7a767](https://github.com/ExaDev/better-auth-api-keys/commit/5a7a767c3c748f4cec72fa547d0c3e1cb296774c))
* re-derive the mutation break threshold after the review fixes ([b5e12af](https://github.com/ExaDev/better-auth-api-keys/commit/b5e12af633e9a0f10bf06fd5d12c30147dd7870f))
* re-derive the mutation break threshold from the system keys run ([0cbbf06](https://github.com/ExaDev/better-auth-api-keys/commit/0cbbf06c4858c4b9d1a24311f52cbf756c2af940))
* run the README's own migration SQL against a 0.1.0 table ([2e5e839](https://github.com/ExaDev/better-auth-api-keys/commit/2e5e83930c220445d322e10035c26d8eb3b0b371))

### Continuous Integration

* find the packed alias tarball without parsing npm's JSON ([c41cdcb](https://github.com/ExaDev/better-auth-api-keys/commit/c41cdcb836fefb464d29ed1c1ab00c6fd8f08b4f))
* publish each release under the alias package names ([5f2727b](https://github.com/ExaDev/better-auth-api-keys/commit/5f2727b3899ac2e27595d69c4b622e13c8c96db5))

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
