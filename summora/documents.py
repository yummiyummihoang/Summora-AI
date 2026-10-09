"""Import tài liệu thành văn bản; không gọi dịch vụ bên ngoài."""

import io
from pathlib import Path
from zipfile import ZipFile

from summora.formats import import_file, parse_data, parse_prompts

MAX_FILE = 24 * 1024 * 1024


def import_document(content, filename, kind="data", field="document"):
    if kind not in {"data", "prompts"}:
        raise ValueError("Loại file không hợp lệ.")
    if not isinstance(content, bytes) or not content or len(content) > MAX_FILE:
        raise ValueError("File rỗng hoặc vượt giới hạn 24 MB.")
    name = Path(filename.replace("\\", "/")).name
    ext = Path(name).suffix.lower()
    if ext in {".json", ".csv"}:
        parsed = import_file(content, name, kind)
        if kind == "prompts":
            import json

            return parse_prompts(json.dumps(parsed, ensure_ascii=False))
        import json

        rows = parse_data(json.dumps(parsed, ensure_ascii=False), field)
        return [
            {
                "title": str(row.get("title") or f"{name} · {i}"),
                "text": row[field],
                "source": name,
                "original": row,
            }
            for i, row in enumerate(rows, 1)
        ]
    if kind == "prompts" and ext != ".txt":
        raise ValueError("Prompt chỉ nhận TXT, JSON hoặc CSV.")
    try:
        if ext == ".txt":
            text = content.decode("utf-8-sig")
        elif ext == ".docx":
            # Giới hạn kích thước giải nén trước khi đọc XML.
            with ZipFile(io.BytesIO(content)) as archive:
                if sum(item.file_size for item in archive.infolist()) > 100 * 1024 * 1024:
                    raise ValueError("DOCX có dung lượng giải nén quá lớn.")
            from docx import Document
            from docx.oxml.ns import qn

            doc = Document(io.BytesIO(content))
            lines = []
            for block in doc.element.body:
                if block.tag == qn("w:p"):
                    lines.append("".join(node.text or "" for node in block.iter(qn("w:t"))))
                elif block.tag == qn("w:tbl"):
                    for row in block.findall(qn("w:tr")):
                        lines.append(
                            "\t".join(
                                "".join(node.text or "" for node in cell.iter(qn("w:t")))
                                for cell in row.findall(qn("w:tc"))
                            )
                        )
            text = "\n".join(lines)
        elif ext == ".pdf":
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(content))
            if reader.is_encrypted:
                raise ValueError("PDF có mật khẩu. Hãy dùng bản không có mật khẩu.")
            if len(reader.pages) > 2000:
                raise ValueError("PDF vượt giới hạn 2.000 trang.")
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
        else:
            raise ValueError("Chỉ hỗ trợ TXT, DOCX, PDF có lớp văn bản, JSON và CSV.")
    except ImportError as exc:
        raise ValueError(
            "Thiếu thư viện đọc DOCX/PDF. Chạy lại start_web.cmd để cài thư viện."
        ) from exc
    except UnicodeError as exc:
        raise ValueError("File TXT phải được lưu với mã hóa UTF-8.") from exc
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("Không đọc được file. Kiểm tra định dạng hoặc file bị hỏng.") from exc
    if not text.strip():
        raise ValueError("Không tìm thấy văn bản. PDF scan/ảnh cần OCR hoặc dán nội dung thủ công.")
    if len(text.encode("utf-8")) > MAX_FILE:
        raise ValueError("Nội dung trích xuất vượt giới hạn 24 MB.")
    if kind == "prompts":
        return [{"name": Path(name).stem, "text": text.strip()}]
    return [{"title": Path(name).stem, "text": text.strip(), "source": name}]
