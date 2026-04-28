#!/usr/bin/env python3
"""Skill Template Manager helper.

This script intentionally manages its own store and uses `npx skills` only as a
staging importer. It does not read from user global skill directories.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_HOME = "~/.skill-template-manager"
DEFAULT_PROJECT_SKILLS_DIR = ".agents/skills"


class StmError(RuntimeError):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def expand(path: str | Path) -> Path:
    return Path(path).expanduser().resolve()


def manager_home(args: argparse.Namespace) -> Path:
    raw = getattr(args, "home", None) or os.environ.get("STM_HOME") or DEFAULT_HOME
    return expand(raw)


def store_dir(home: Path) -> Path:
    return home / "store"


def templates_dir(home: Path) -> Path:
    return home / "templates"


def staging_dir(home: Path) -> Path:
    return home / ".staging"


def init_home(home: Path) -> None:
    store_dir(home).mkdir(parents=True, exist_ok=True)
    templates_dir(home).mkdir(parents=True, exist_ok=True)
    staging_dir(home).mkdir(parents=True, exist_ok=True)


def sanitize_name(name: str) -> str:
    value = name.strip().lower()
    value = re.sub(r"[^a-z0-9._-]+", "-", value)
    value = value.strip(".-")
    if not value:
        raise StmError(f"Invalid empty skill/template name from {name!r}")
    if value in {".", ".."} or "/" in value or "\\" in value:
        raise StmError(f"Unsafe name: {name!r}")
    return value[:255]


def parse_skill_md(skill_md: Path) -> dict[str, Any]:
    if not skill_md.is_file():
        raise StmError(f"Missing SKILL.md: {skill_md}")
    text = skill_md.read_text(encoding="utf-8")
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise StmError(f"SKILL.md lacks YAML frontmatter: {skill_md}")
    data: dict[str, Any] = {}
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = re.match(r"^([A-Za-z0-9_.-]+):\s*(.*)$", line)
        if match:
            key, value = match.group(1), match.group(2).strip()
            if (value.startswith('"') and value.endswith('"')) or (
                value.startswith("'") and value.endswith("'")
            ):
                value = value[1:-1]
            data[key] = value
    name = data.get("name")
    description = data.get("description")
    if not isinstance(name, str) or not name.strip():
        raise StmError(f"SKILL.md missing required name: {skill_md}")
    if not isinstance(description, str) or not description.strip():
        raise StmError(f"SKILL.md missing required description: {skill_md}")
    return data


def validate_skill_dir(path: Path) -> dict[str, Any]:
    if not path.is_dir():
        raise StmError(f"Skill path is not a directory: {path}")
    data = parse_skill_md(path / "SKILL.md")
    return {
        "rawName": data["name"],
        "name": sanitize_name(str(data["name"])),
        "description": data["description"],
        "path": str(path),
    }


def ensure_inside(child: Path, parent: Path, label: str) -> None:
    try:
        child.resolve().relative_to(parent.resolve())
    except ValueError as exc:
        raise StmError(f"{label} points outside manager home: {child}") from exc


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise StmError(f"Missing JSON file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise StmError(f"Invalid JSON file: {path}: {exc}") from exc


def symlink_relative(target: Path, link: Path) -> str:
    target = target.resolve()
    link_parent = link.parent.resolve()
    return os.path.relpath(target, link_parent)


def create_symlink(target: Path, link: Path, *, force: bool = False) -> str:
    target = target.resolve()
    link.parent.mkdir(parents=True, exist_ok=True)
    if link.is_symlink():
        current = (link.parent / os.readlink(link)).resolve()
        if current == target:
            return "unchanged"
        if not force:
            raise StmError(f"Symlink already exists with different target: {link} -> {current}")
        link.unlink()
    elif link.exists():
        raise StmError(f"Refusing to overwrite real path: {link}")
    os.symlink(symlink_relative(target, link), link, target_is_directory=target.is_dir())
    return "created"


def copy_skill_to_store(src: Path, home: Path, *, force: bool, source_meta: dict[str, Any]) -> Path:
    info = validate_skill_dir(src)
    name = info["name"]
    dest = store_dir(home) / name
    ensure_inside(dest, store_dir(home), "store destination")
    if dest.exists() or dest.is_symlink():
        if not force:
            raise StmError(f"Store skill already exists: {dest}. Use --force only when updating/reinstalling.")
        if dest.is_symlink() or dest.is_file():
            dest.unlink()
        else:
            shutil.rmtree(dest)
    ignore = shutil.ignore_patterns(".git", "node_modules", "__pycache__", ".DS_Store")
    shutil.copytree(src, dest, symlinks=True, ignore=ignore)
    metadata = {
        "schemaVersion": 1,
        "manager": "skill-template-manager",
        "name": name,
        "rawName": info["rawName"],
        "source": source_meta,
        "installedAt": now_iso(),
    }
    write_json(dest / ".stm" / "source.json", metadata)
    return dest


def template_skills_dir(home: Path, template: str) -> Path:
    name = sanitize_name(template)
    return templates_dir(home) / name / "skills"


def ensure_template(home: Path, template: str) -> Path:
    tdir = templates_dir(home) / sanitize_name(template)
    (tdir / "skills").mkdir(parents=True, exist_ok=True)
    readme = tdir / "TEMPLATE.md"
    if not readme.exists():
        readme.write_text(
            f"# {sanitize_name(template)}\n\n"
            "Managed by Skill template manager.\n"
            "Changing this template affects every project linked to it.\n",
            encoding="utf-8",
        )
    return tdir


def store_skill_path(home: Path, skill: str) -> Path:
    path = store_dir(home) / sanitize_name(skill)
    if not path.is_dir():
        raise StmError(f"Store skill not found: {path}")
    validate_skill_dir(path)
    return path


def add_skill_to_template(home: Path, template: str, skill: str, *, force: bool = False) -> str:
    tdir = ensure_template(home, template)
    target = store_skill_path(home, skill)
    link = tdir / "skills" / target.name
    return create_symlink(target, link, force=force)


def run_command(cmd: list[str], cwd: Path, env_extra: dict[str, str] | None = None) -> int:
    env = os.environ.copy()
    env.update(
        {
            "DISABLE_TELEMETRY": "1",
            "DO_NOT_TRACK": "1",
            "NO_COLOR": "1",
            "CI": "1",
        }
    )
    if env_extra:
        env.update(env_extra)
    proc = subprocess.run(cmd, cwd=str(cwd), env=env)
    return proc.returncode


def run_command_capture(cmd: list[str], cwd: Path, env_extra: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.update(
        {
            "DISABLE_TELEMETRY": "1",
            "DO_NOT_TRACK": "1",
            "NO_COLOR": "1",
            "CI": "1",
            "TERM": "dumb",
        }
    )
    if env_extra:
        env.update(env_extra)
    return subprocess.run(cmd, cwd=str(cwd), env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)


def cmd_init(args: argparse.Namespace) -> None:
    home = manager_home(args)
    init_home(home)
    print(f"managerHome={home}")
    print(f"store={store_dir(home)}")
    print(f"templates={templates_dir(home)}")


def cmd_npx_find(args: argparse.Namespace) -> None:
    query = " ".join(args.query)
    code = run_command(["npx", "skills", "find", query], Path.cwd())
    raise SystemExit(code)


def cmd_npx_list(args: argparse.Namespace) -> None:
    cmd = ["npx", "skills", "add", args.source, "--list"]
    if args.full_depth:
        cmd.append("--full-depth")
    env = {"INSTALL_INTERNAL_SKILLS": "1"} if args.include_internal else None
    code = run_command(cmd, Path.cwd(), env)
    raise SystemExit(code)


def cmd_import_npx(args: argparse.Namespace) -> None:
    home = manager_home(args)
    init_home(home)
    install_id = uuid.uuid4().hex
    stage = staging_dir(home) / install_id
    stage.mkdir(parents=True, exist_ok=False)
    env = {"INSTALL_INTERNAL_SKILLS": "1"} if args.include_internal else None
    cmd = ["npx", "skills", "add", args.source, "--agent", "codex", "--copy", "-y"]
    if args.skill:
        cmd.extend(["--skill", args.skill])
    if args.full_depth:
        cmd.append("--full-depth")
    try:
        result = run_command_capture(cmd, stage, env)
        if result.returncode != 0:
            sys.stdout.write(result.stdout)
            raise StmError(f"npx skills staging import failed with exit code {result.returncode}")
        skills_root = stage / ".agents" / "skills"
        if not skills_root.is_dir():
            sys.stdout.write(result.stdout)
            raise StmError(f"Staging install did not produce {skills_root}")
        candidates = sorted([p for p in skills_root.iterdir() if p.is_dir() and (p / "SKILL.md").is_file()])
        if not candidates:
            sys.stdout.write(result.stdout)
            raise StmError("Staging install produced no valid skills")
        if len(candidates) > 1 and not args.all:
            names = ", ".join(p.name for p in candidates)
            raise StmError(f"Source produced multiple skills ({names}). Re-run with --skill <name> or --all.")
        imported: list[Path] = []
        for candidate in candidates:
            source_meta = {
                "type": "npx-skills",
                "specifier": args.source,
            }
            if args.skill:
                source_meta["skill"] = args.skill
            imported_path = copy_skill_to_store(candidate, home, force=args.force, source_meta=source_meta)
            imported.append(imported_path)
            if args.template:
                action = add_skill_to_template(home, args.template, imported_path.name, force=True)
                print(f"templateLink={args.template}/{imported_path.name}:{action}")
        for path in imported:
            print(f"imported={path}")
    finally:
        shutil.rmtree(stage, ignore_errors=True)


def cmd_adopt(args: argparse.Namespace) -> None:
    home = manager_home(args)
    init_home(home)
    src = expand(args.path)
    dest = copy_skill_to_store(src, home, force=args.force, source_meta={"type": "manual", "path": str(src)})
    if args.template:
        action = add_skill_to_template(home, args.template, dest.name, force=True)
        print(f"templateLink={args.template}/{dest.name}:{action}")
    print(f"adopted={dest}")


def cmd_store_list(args: argparse.Namespace) -> None:
    home = manager_home(args)
    init_home(home)
    items = []
    for path in sorted(store_dir(home).iterdir()):
        if not path.is_dir():
            continue
        try:
            info = validate_skill_dir(path)
            source_path = path / ".stm" / "source.json"
            source = read_json(source_path).get("source") if source_path.exists() else None
            items.append({"name": info["name"], "path": str(path), "source": source})
        except StmError as exc:
            items.append({"name": path.name, "path": str(path), "error": str(exc)})
    if args.json:
        print(json.dumps(items, indent=2, sort_keys=True))
    else:
        for item in items:
            status = "error" if "error" in item else "ok"
            print(f"{item['name']}\t{status}\t{item['path']}")


def cmd_template_create(args: argparse.Namespace) -> None:
    home = manager_home(args)
    init_home(home)
    tdir = ensure_template(home, args.template)
    print(f"template={tdir}")


def cmd_template_add(args: argparse.Namespace) -> None:
    home = manager_home(args)
    init_home(home)
    action = add_skill_to_template(home, args.template, args.skill, force=args.force)
    print(f"templateLink={args.template}/{sanitize_name(args.skill)}:{action}")


def cmd_template_remove(args: argparse.Namespace) -> None:
    home = manager_home(args)
    link = template_skills_dir(home, args.template) / sanitize_name(args.skill)
    if not link.exists() and not link.is_symlink():
        print(f"missing={link}")
        return
    if not link.is_symlink():
        raise StmError(f"Refusing to remove non-symlink template entry: {link}")
    link.unlink()
    print(f"removed={link}")


def cmd_template_list(args: argparse.Namespace) -> None:
    home = manager_home(args)
    init_home(home)
    data = []
    for tdir in sorted(templates_dir(home).iterdir()):
        skills_dir = tdir / "skills"
        if not tdir.is_dir() or not skills_dir.is_dir():
            continue
        skills = sorted(p.name for p in skills_dir.iterdir())
        data.append({"name": tdir.name, "path": str(tdir), "skills": skills})
    if args.json:
        print(json.dumps(data, indent=2, sort_keys=True))
    else:
        for item in data:
            print(f"{item['name']}\t{len(item['skills'])} skills\t{item['path']}")


def project_skills_path(project: str, skills_dir: str) -> Path:
    return expand(project) / skills_dir


def path_points_under(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def cmd_link_template(args: argparse.Namespace) -> None:
    home = manager_home(args)
    target = template_skills_dir(home, args.template)
    if not target.is_dir():
        raise StmError(f"Template skills directory not found: {target}")
    link = project_skills_path(args.project, args.skills_dir)
    if link.is_symlink():
        current = (link.parent / os.readlink(link)).resolve()
        if current == target.resolve():
            print(f"projectLink={link}:unchanged")
            return
        if not path_points_under(current, templates_dir(home)) and not args.force:
            raise StmError(f"Refusing to replace non-manager project skills symlink: {link} -> {current}")
        link.unlink()
    elif link.exists():
        raise StmError(f"Refusing to overwrite real project skills directory: {link}")
    create_symlink(target, link)
    print(f"projectLink={link}:created")


def cmd_link_skill(args: argparse.Namespace) -> None:
    home = manager_home(args)
    target = store_skill_path(home, args.skill)
    skills_path = project_skills_path(args.project, args.skills_dir)
    if skills_path.is_symlink():
        current = (skills_path.parent / os.readlink(skills_path)).resolve()
        raise StmError(
            f"Refusing to add a single skill into symlinked project skills directory: {skills_path} -> {current}"
        )
    skills_path.mkdir(parents=True, exist_ok=True)
    link = skills_path / target.name
    action = create_symlink(target, link, force=args.force)
    print(f"skillLink={link}:{action}")


def cmd_unlink_project(args: argparse.Namespace) -> None:
    home = manager_home(args)
    link = project_skills_path(args.project, args.skills_dir)
    if not link.exists() and not link.is_symlink():
        print(f"missing={link}")
        return
    if not link.is_symlink():
        raise StmError(f"Refusing to remove real project skills directory: {link}")
    target = (link.parent / os.readlink(link)).resolve()
    if not path_points_under(target, templates_dir(home)) and not args.force:
        raise StmError(f"Refusing to remove non-manager project skills symlink: {link} -> {target}")
    link.unlink()
    print(f"unlinked={link}")


def cmd_update(args: argparse.Namespace) -> None:
    home = manager_home(args)
    skill_path = store_skill_path(home, args.skill)
    metadata_path = skill_path / ".stm" / "source.json"
    metadata = read_json(metadata_path)
    source = metadata.get("source", {})
    if source.get("type") != "npx-skills":
        raise StmError(f"Skill cannot be automatically updated from source type: {source.get('type')!r}")
    import_args = argparse.Namespace(
        home=str(home),
        source=source["specifier"],
        skill=source.get("skill"),
        template=None,
        force=True,
        all=False,
        full_depth=args.full_depth,
        include_internal=args.include_internal,
    )
    cmd_import_npx(import_args)


def collect_doctor(home: Path, project: str | None, skills_dir: str, template: str | None) -> dict[str, Any]:
    init_home(home)
    report: dict[str, Any] = {
        "managerHome": str(home),
        "errors": [],
        "warnings": [],
        "store": [],
        "templates": [],
        "project": None,
    }
    for path in sorted(store_dir(home).iterdir()):
        if not path.is_dir():
            continue
        item: dict[str, Any] = {"name": path.name, "path": str(path)}
        try:
            info = validate_skill_dir(path)
            item["skillName"] = info["name"]
            if not (path / ".stm" / "source.json").is_file():
                item["warning"] = "missing source metadata"
                report["warnings"].append(f"{path}: missing source metadata")
        except StmError as exc:
            item["error"] = str(exc)
            report["errors"].append(str(exc))
        report["store"].append(item)
    template_dirs = [templates_dir(home) / sanitize_name(template)] if template else sorted(templates_dir(home).iterdir())
    for tdir in template_dirs:
        if not tdir.exists():
            report["errors"].append(f"Template not found: {tdir}")
            continue
        skills_path = tdir / "skills"
        titem: dict[str, Any] = {"name": tdir.name, "path": str(tdir), "skills": []}
        if not skills_path.is_dir():
            titem["error"] = f"Missing skills directory: {skills_path}"
            report["errors"].append(titem["error"])
            report["templates"].append(titem)
            continue
        for entry in sorted(skills_path.iterdir()):
            sitem: dict[str, Any] = {"name": entry.name, "path": str(entry)}
            if not entry.is_symlink():
                sitem["error"] = "not a symlink"
                report["errors"].append(f"{entry}: not a symlink")
            else:
                target = (entry.parent / os.readlink(entry)).resolve()
                sitem["target"] = str(target)
                if not target.exists():
                    sitem["error"] = "broken symlink"
                    report["errors"].append(f"{entry}: broken symlink -> {target}")
                elif not path_points_under(target, store_dir(home)):
                    sitem["error"] = "target outside manager store"
                    report["errors"].append(f"{entry}: target outside manager store -> {target}")
                else:
                    try:
                        validate_skill_dir(target)
                        sitem["status"] = "ok"
                    except StmError as exc:
                        sitem["error"] = str(exc)
                        report["errors"].append(str(exc))
            titem["skills"].append(sitem)
        report["templates"].append(titem)
    if project:
        link = project_skills_path(project, skills_dir)
        pitem: dict[str, Any] = {"project": str(expand(project)), "skillsDir": str(link)}
        if not link.exists() and not link.is_symlink():
            pitem["status"] = "missing"
        elif link.is_symlink():
            target = (link.parent / os.readlink(link)).resolve()
            pitem["target"] = str(target)
            if path_points_under(target, templates_dir(home)):
                pitem["status"] = "manager-template"
            else:
                pitem["warning"] = "symlink target is outside manager templates"
                report["warnings"].append(f"{link}: target outside manager templates -> {target}")
        else:
            pitem["status"] = "real-directory"
            pitem["warning"] = "project skills dir is a real directory; template symlink mode will not overwrite it"
            report["warnings"].append(f"{link}: real directory")
        report["project"] = pitem
    return report


def cmd_doctor(args: argparse.Namespace) -> None:
    home = manager_home(args)
    report = collect_doctor(home, args.project, args.skills_dir, args.template)
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
        return
    print(f"managerHome={report['managerHome']}")
    print(f"errors={len(report['errors'])}")
    print(f"warnings={len(report['warnings'])}")
    for err in report["errors"]:
        print(f"ERROR {err}")
    for warn in report["warnings"]:
        print(f"WARN {warn}")
    for item in report["store"]:
        status = item.get("error") or item.get("warning") or "ok"
        print(f"STORE {item['name']} {status}")
    for titem in report["templates"]:
        print(f"TEMPLATE {titem['name']} {len(titem.get('skills', []))} skills")
        for sitem in titem.get("skills", []):
            status = sitem.get("error") or sitem.get("status") or "unknown"
            print(f"  {sitem['name']} {status}")
    if report["project"]:
        print(f"PROJECT {report['project']}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Skill Template Manager helper")
    parser.add_argument("--home", help="Manager home directory; defaults to STM_HOME or ~/.skill-template-manager")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("init", help="Initialize manager directories")
    p.set_defaults(func=cmd_init)

    p = sub.add_parser("npx-find", help="Run npx skills find")
    p.add_argument("query", nargs="+")
    p.set_defaults(func=cmd_npx_find)

    p = sub.add_parser("npx-list", help="Run npx skills add <source> --list")
    p.add_argument("source")
    p.add_argument("--full-depth", action="store_true")
    p.add_argument("--include-internal", action="store_true")
    p.set_defaults(func=cmd_npx_list)

    p = sub.add_parser("import-npx", help="Import from npx skills into the manager store")
    p.add_argument("source")
    p.add_argument("--skill")
    p.add_argument("--template")
    p.add_argument("--force", action="store_true")
    p.add_argument("--all", action="store_true", help="Allow importing multiple skills")
    p.add_argument("--full-depth", action="store_true")
    p.add_argument("--include-internal", action="store_true")
    p.set_defaults(func=cmd_import_npx)

    p = sub.add_parser("adopt", help="Copy a local skill into the manager store")
    p.add_argument("path")
    p.add_argument("--template")
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_adopt)

    p = sub.add_parser("store-list", help="List manager store skills")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_store_list)

    p = sub.add_parser("template-create", help="Create a template")
    p.add_argument("template")
    p.set_defaults(func=cmd_template_create)

    p = sub.add_parser("template-add", help="Add a store skill to a template")
    p.add_argument("template")
    p.add_argument("skill")
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_template_add)

    p = sub.add_parser("template-remove", help="Remove a skill symlink from a template")
    p.add_argument("template")
    p.add_argument("skill")
    p.set_defaults(func=cmd_template_remove)

    p = sub.add_parser("template-list", help="List templates")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_template_list)

    p = sub.add_parser("link-template", help="Link a template into a project")
    p.add_argument("template")
    p.add_argument("--project", default=".")
    p.add_argument("--skills-dir", default=DEFAULT_PROJECT_SKILLS_DIR)
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_link_template)

    p = sub.add_parser("link-skill", help="Link one store skill into a project real skills directory")
    p.add_argument("skill")
    p.add_argument("--project", default=".")
    p.add_argument("--skills-dir", default=DEFAULT_PROJECT_SKILLS_DIR)
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_link_skill)

    p = sub.add_parser("unlink-project", help="Remove a project skills symlink to a manager template")
    p.add_argument("--project", default=".")
    p.add_argument("--skills-dir", default=DEFAULT_PROJECT_SKILLS_DIR)
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_unlink_project)

    p = sub.add_parser("update", help="Re-import a store skill from source metadata")
    p.add_argument("skill")
    p.add_argument("--full-depth", action="store_true")
    p.add_argument("--include-internal", action="store_true")
    p.set_defaults(func=cmd_update)

    p = sub.add_parser("doctor", help="Validate manager, template, and project state")
    p.add_argument("--project")
    p.add_argument("--template")
    p.add_argument("--skills-dir", default=DEFAULT_PROJECT_SKILLS_DIR)
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_doctor)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        args.func(args)
        return 0
    except StmError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
