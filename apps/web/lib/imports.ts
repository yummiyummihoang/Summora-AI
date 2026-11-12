import { basename, extname } from "node:path";
import { parsePrompts } from "@/lib/summarization";

function parseCsv(text: string) {
  const input = text.replace(/^\uFEFF/, "");
  const first = input.split(/\r?\n/, 1)[0];
  const countDelimiter = (line: string, delimiter: string) => {
    let count = 0,
      inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"' && inQuotes && line[i + 1] === '"') i++;
      else if (line[i] === '"') inQuotes = !inQuotes;
      else if (!inQuotes && line[i] === delimiter) count++;
    }
    return count;
  };
  const delimiter = [",", ";", "\t"].sort(
    (a, b) => countDelimiter(first, b) - countDelimiter(first, a),
  )[0];
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted && c === '"' && input[i + 1] === '"') {
      field += '"';
      i++;
    } else if (c === '"') quoted = !quoted;
    else if (!quoted && c === delimiter) {
      row.push(field);
      field = "";
    } else if (!quoted && (c === "\n" || c === "\r")) {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  if (quoted) throw new Error("CSV sai định dạng. Kiểm tra dấu nháy kép.");
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  if (rows.length < 2) throw new Error("CSV không có bản ghi dữ liệu.");
  const headers = rows[0].map((x) => x.trim());
  if (headers.some((x) => !x) || new Set(headers).size !== headers.length)
    throw new Error("CSV cần hàng tiêu đề; tên cột không được rỗng hoặc trùng nhau.");
  return rows.slice(1).map((values, i) => {
    if (values.length !== headers.length)
      throw new Error(`CSV dòng ${i + 2}: số ô không khớp số cột.`);
    return Object.fromEntries(headers.map((header, j) => [header, values[j]]));
  });
}

function parseJson(content: string) {
  try {
    return JSON.parse(content.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("File phải là JSON hợp lệ, mã hóa UTF-8.");
  }
}

function validateDocxArchive(bytes: Buffer) {
  const start = Math.max(0, bytes.length - 65_557);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= start; offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error("DOCX không hợp lệ.");
  const entries = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  let offset = bytes.readUInt32LE(end + 16),
    total = 0;
  if (offset + directorySize > bytes.length) throw new Error("DOCX không hợp lệ.");
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw new Error("DOCX không hợp lệ.");
    const size = bytes.readUInt32LE(offset + 24);
    if (size === 0xffffffff) throw new Error("DOCX vượt giới hạn giải nén.");
    total += size;
    if (total > 100 * 1024 * 1024) throw new Error("DOCX có dung lượng giải nén quá lớn.");
    offset +=
      46 +
      bytes.readUInt16LE(offset + 28) +
      bytes.readUInt16LE(offset + 30) +
      bytes.readUInt16LE(offset + 32);
  }
}

export async function importDocument(file: File, kind: string, documentField: string) {
  if (!file.size || file.size > 3 * 1024 * 1024)
    throw new Error("File rỗng hoặc vượt giới hạn 3 MB.");
  if (!["data", "prompts"].includes(kind)) throw new Error("Loại file không hợp lệ.");
  const name = basename(file.name.replaceAll("\\", "/")),
    ext = extname(name).toLowerCase();
  const bytes = Buffer.from(await file.arrayBuffer());
  let parsed: unknown;
  if (ext === ".json" || ext === ".csv") {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parsed = ext === ".json" ? parseJson(text) : parseCsv(text);
    if (kind === "prompts") {
      if (ext === ".csv")
        parsed = (parsed as Array<Record<string, string>>).map((x, i) => ({
          name: x.name?.trim() || `p${i}`,
          text: x.text,
        }));
      return parsePrompts(parsed);
    }
    const object =
      parsed && !Array.isArray(parsed) && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : null;
    const rows: unknown = object ? (Array.isArray(object.data) ? object.data : [object]) : parsed;
    if (!Array.isArray(rows) || !rows.length)
      throw new Error('Data phải là mảng bản ghi, một bản ghi, hoặc {"data": [...]} không rỗng.');
    return rows.map((row: unknown, i: number) => {
      if (!row || typeof row !== "object") throw new Error(`Bản ghi ${i + 1} phải là object JSON.`);
      const dataRow = row as Record<string, unknown>;
      if (typeof dataRow[documentField] !== "string" || !dataRow[documentField].trim())
        throw new Error(`Bản ghi ${i + 1}: trường '${documentField}' phải là chuỗi không rỗng.`);
      if ("generated_summaries" in dataRow)
        throw new Error(`Bản ghi ${i + 1} đã có generated_summaries; dùng file dữ liệu nguồn.`);
      return {
        title: String(dataRow.title || `${name} · ${i + 1}`),
        text: dataRow[documentField] as string,
        source: name,
        original: dataRow,
      };
    });
  }
  if (kind === "prompts" && ext !== ".txt") throw new Error("Prompt chỉ nhận TXT, JSON hoặc CSV.");
  let text: string;
  if (ext === ".txt")
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  else if (ext === ".docx") {
    validateDocxArchive(bytes);
    const mammoth = await import("mammoth");
    text = (await mammoth.extractRawText({ buffer: bytes })).value;
  } else if (ext === ".pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: bytes });
    try {
      const info = await parser.getInfo();
      if (info.total > 2000) throw new Error("PDF vượt giới hạn 2.000 trang.");
      const result = await parser.getText();
      text = result.text;
    } catch (error) {
      if (error instanceof Error && error.message === "PDF vượt giới hạn 2.000 trang.") throw error;
      throw new Error("Không đọc được file. Kiểm tra định dạng, mật khẩu hoặc file bị hỏng.");
    } finally {
      await parser.destroy();
    }
  } else throw new Error("Chỉ hỗ trợ TXT, DOCX, PDF có lớp văn bản, JSON và CSV.");
  if (!text.trim())
    throw new Error("Không tìm thấy văn bản. PDF scan/ảnh cần OCR hoặc dán nội dung thủ công.");
  if (Buffer.byteLength(text, "utf8") > 3 * 1024 * 1024)
    throw new Error("Nội dung trích xuất vượt giới hạn 3 MB.");
  return kind === "prompts"
    ? [{ name: name.replace(/\.[^.]+$/, ""), text: text.trim() }]
    : [{ title: name.replace(/\.[^.]+$/, ""), text: text.trim(), source: name }];
}
