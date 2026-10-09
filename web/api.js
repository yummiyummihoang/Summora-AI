let csrf = "";
export function setCsrf(value) {
  csrf = value || "";
}
export async function api(path, body, extra = {}) {
  const options =
    body === undefined
      ? {}
      : {
          method: "POST",
          body: body instanceof FormData ? body : JSON.stringify(body),
        };
  options.headers = {
    ...(body instanceof FormData || body === undefined
      ? {}
      : { "Content-Type": "application/json" }),
    ...(body === undefined ? {} : { "X-CSRF-Token": csrf }),
    ...extra,
  };
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new Error("Mất kết nối server. Yêu cầu có thể đã được nhận.");
  }
  let value;
  try {
    value = await response.json();
  } catch {
    throw new Error("Server trả phản hồi không hợp lệ.");
  }
  if (!response.ok) {
    const error = new Error(value.error || "Không thể xử lý yêu cầu.");
    error.status = response.status;
    throw error;
  }
  return value;
}
