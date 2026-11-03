"""Profile appended to the digest-pinned source overlay engine by release.py."""
NEW = frozenset({"server/powcat-reader.mjs", "src/shared/protocol/powcat1.mjs"})
ALLOWED = NEW | {"server/proof-api.mjs"}
BASE_SOURCE_COMMIT = "c3969c39c2b2f0d8dc927c868dfd52b977ce0a34"
BASELINE_HEAD = "92eb5fbdaacfd05955dae6d994586850f93944b9"
ACCEPTED_SHA = "ca974e0a77414b4412c5b66333a429989a1bbd445b5b8333a3bd1fbc7c991ba4"
API_SHA = "70ba5912ba55e4c9c6ac243dc6c9db31456b77410e80e727b7886c870da2c814"
FAMILY = "proof-of-work-powcat-scoped-runtime-v1"
validate_engine_manifest = validate_manifest
engine_fence = fence


def validate_manifest(m):
    require(m.get("format") == FAMILY and m.get("baselineHead") == BASELINE_HEAD
            and m.get("acceptedInventorySha256") == ACCEPTED_SHA, "Wrong powcat release provenance")
    result = validate_engine_manifest({**m, "format": "proof-of-work-amo-browse-scoped-runtime-v1"})
    require(next(r for r in m["sources"] if r["path"] == "server/proof-api.mjs")["before"] == API_SHA,
            "Wrong accepted API source")
    return result


def fence(root, m, candidates, phase="baseline"):
    inventory = Path("/etc/proofofwork-retention/node-source-overlays.json")
    require(sha(safe_read(inventory, 4 * 1024**2)) == ACCEPTED_SHA, "Accepted source inventory changed")
    engine_fence(root, m, candidates, phase)


# Keep the created inode identities available throughout the guarded cutover.
# A failed attempt may remove only an exact helper this attempt installed.
created_helpers = {}
engine_install = install


def install(root, backup, rows, metadata, candidate, stamp):
    if candidate:
        # Install dependencies before the API that imports them. The engine
        # indexes its prepared files by the rows' original positions.
        require([r["path"] for r in rows] == sorted(NEW) + ["server/proof-api.mjs"],
                "Unexpected scoped installation order")
    if not candidate:
        engine_install(root, backup, rows, metadata, False, stamp)
        for name in NEW:
            target = root / name
            if not os.path.lexists(target):
                continue
            info = target.lstat()
            require(created_helpers.get(name) == (info.st_dev, info.st_ino)
                    and sha(safe_read(target)) == next(row["after"] for row in rows if row["path"] == name),
                    "Refuse rollback of an unowned helper")
            target.unlink()
            sync(target.parent)
        return
    for index, row in enumerate(rows):
        name = row["path"]
        target = root / name
        before = safe_read(target, absent=name in NEW)
        require((None if before is None else sha(before)) == row["before"], "Source changed before installation")
        temp = target.with_name(target.name + ".powcat-candidate-" + stamp)
        durable(temp, (backup / f"candidate-{index}.mjs").read_bytes())
        uid, gid, mode = metadata[name]
        os.chown(temp, uid, gid)
        os.chmod(temp, mode)
        if name in NEW:
            info = temp.lstat()
            created_helpers[name] = (info.st_dev, info.st_ino)
            os.link(temp, target, follow_symlinks=False)
            temp.unlink()
        else:
            os.replace(temp, target)
        sync(target.parent)
