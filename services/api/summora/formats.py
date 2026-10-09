"""CSV/JSON parsing, prompt validation and atomic JSON output."""

import csv
import io
import json
from pathlib import Path


def parse_csv(content):
    """CSV UTF-8: hỗ trợ BOM, dấu phẩy/chấm phẩy và ô nhiều dòng có dấu nháy."""
    if isinstance(content, (bytes, bytearray, memoryview)):
        content = bytes(content).decode("utf-8-sig")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("File CSV rỗng.")
    content = content.lstrip("\ufeff")
    csv.field_size_limit(25 * 1024 * 1024)
    first_line = content.splitlines()[0]
    delimiter = max(
        (",", ";", "\t"), key=lambda d: len(next(csv.reader([first_line], delimiter=d)))
    )
    try:
        reader = csv.reader(io.StringIO(content, newline=""), delimiter=delimiter, strict=True)
        headers = [header.strip() for header in next(reader)]
        if any(not h for h in headers) or len(set(headers)) != len(headers):
            raise ValueError("CSV cần hàng tiêu đề; tên cột không được rỗng hoặc trùng nhau.")
        rows = []
        for values in reader:
            if not values or all(not value.strip() for value in values):
                continue
            if len(values) != len(headers):
                raise ValueError(
                    f"CSV dòng {reader.line_num}: số ô không khớp số cột; kiểm tra dấu nháy và dấu phân cách."
                )
            rows.append(dict(zip(headers, values)))
    except csv.Error as exc:
        raise ValueError(
            "CSV sai định dạng. Ô chứa dấu phân cách hoặc xuống dòng phải được đặt trong dấu nháy kép."
        ) from exc
    if not rows:
        raise ValueError("CSV không có bản ghi dữ liệu.")
    return rows


def import_file(content, filename, kind):
    if kind not in {"data", "prompts"}:
        raise ValueError("Loại file không hợp lệ.")
    extension = Path(filename).suffix.lower()
    if extension == ".json":
        return read_json(content)
    if extension != ".csv":
        raise ValueError("Chỉ hỗ trợ file .json hoặc .csv, mã hóa UTF-8.")
    rows = parse_csv(content)
    if kind == "data":
        return rows
    if "text" not in rows[0]:
        raise ValueError("CSV prompt cần cột 'text'; cột 'name' là tùy chọn.")
    prompts = [
        {"name": row.get("name", "").strip() or f"p{i}", "text": row["text"]}
        for i, row in enumerate(rows)
    ]
    return parse_prompts(json.dumps(prompts, ensure_ascii=False))


def read_json(content):
    if isinstance(content, (bytes, bytearray, memoryview)):
        content = bytes(content).decode("utf-8-sig")
    try:
        return json.loads(content)
    except (ValueError, TypeError) as exc:
        raise ValueError("File phải là JSON hợp lệ, mã hóa UTF-8.") from exc


def parse_data(content, document_field="document"):
    data = read_json(content)
    if isinstance(data, dict):
        data = data["data"] if isinstance(data.get("data"), list) else [data]
    if not isinstance(data, list) or not data:
        raise ValueError('Data phải là mảng bản ghi, một bản ghi, hoặc {"data": [...]} không rỗng.')
    for i, row in enumerate(data, 1):
        if not isinstance(row, dict):
            raise ValueError(f"Bản ghi {i} phải là object JSON.")
        text = row.get(document_field)
        if not isinstance(text, str) or not text.strip():
            raise ValueError(f"Bản ghi {i}: trường '{document_field}' phải là chuỗi không rỗng.")
        if "generated_summaries" in row:
            raise ValueError(f"Bản ghi {i} đã có generated_summaries; dùng file dữ liệu nguồn.")
    return data


def parse_prompts(content):
    data = read_json(content)
    if isinstance(data, dict):
        data = data.get("prompts")
    if not isinstance(data, list) or not data:
        raise ValueError('Prompt phải là mảng hoặc {"prompts": [...]} không rỗng.')
    prompts, names = [], set()
    for i, item in enumerate(data):
        if isinstance(item, str):
            name, text = f"p{i}", item
        elif isinstance(item, dict):
            name, text = item.get("name", f"p{i}"), item.get("text")
        else:
            raise ValueError(f"Prompt {i + 1} phải là chuỗi hoặc object name/text.")
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"Prompt {i + 1}: name không hợp lệ.")
        if not isinstance(text, str) or not text.strip():
            raise ValueError(f"Prompt {i + 1}: nội dung rỗng hoặc không phải chuỗi.")
        name = name.strip()
        if name in names:
            raise ValueError(f"Tên prompt bị trùng: {name}")
        names.add(name)
        prompts.append({"name": name, "text": text.strip()})
    return prompts


def save_json(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)
