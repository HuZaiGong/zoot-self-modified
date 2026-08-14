"""把 plugins/<name> 打成可安装的插件包，供插件管理页/安装接口使用。

ZOOT 约定插件包扩展名为 .zoot-plugin（内容为 zip，安装接口不校验后缀）。
用法：
    python tools/build_plugin_package.py [插件名]

默认打包 custom-embedding-model，输出 plugins/<name>.zoot-plugin。
"""

from __future__ import annotations

import pathlib
import sys
import zipfile


def main(argv):
    name = argv[1] if len(argv) > 1 else "custom-embedding-model"
    root = pathlib.Path(__file__).resolve().parents[1]
    source = root / "plugins" / name
    if not source.is_dir():
        raise SystemExit(f"插件目录不存在：{source}")
    if not (source / "manifest.json").is_file():
        raise SystemExit(f"{source} 缺少 manifest.json")

    output = root / "plugins" / f"{name}.zoot-plugin"
    count = 0
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source.rglob("*")):
            if not path.is_file():
                continue
            if "__pycache__" in path.parts or path.suffix in {".pyc"}:
                continue
            archive.write(path, path.relative_to(source).as_posix())
            count += 1
    print(f"已打包 {count} 个文件 -> {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
