use ::windows::core::PCWSTR;
use ::windows::Win32::Foundation::{LocalFree, HLOCAL};
use ::windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};

const MAX_VALUE_BYTES: usize = 64 * 1024;
pub const MAX_IPC_BYTES: usize = 3 * MAX_VALUE_BYTES;

#[derive(serde::Deserialize)]
struct Request {
    id: String,
    action: String,
    scope: String,
    value: String,
}

pub fn handle_request(message: &str) -> Option<serde_json::Value> {
    let request: Request = serde_json::from_str(message).ok()?;
    if request.id.len() != 32 || !request.id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let value = if request.scope.len() <= 512 {
        let binding = format!("Sancord desktop auth v1:{}", request.scope);
        match request.action.as_str() {
            "seal" if request.value.len() <= MAX_VALUE_BYTES => {
                transform(request.value.into_bytes(), binding.into_bytes(), true).map(hex::encode)
            }
            "open" if request.value.len() <= 2 * (MAX_VALUE_BYTES + 1024) => hex::decode(request.value)
                .ok()
                .and_then(|input| transform(input, binding.into_bytes(), false))
                .and_then(|plain| String::from_utf8(plain).ok()),
            _ => None,
        }
    } else {
        None
    };
    Some(serde_json::json!({ "id": request.id, "value": value }))
}

fn transform(mut value: Vec<u8>, mut binding: Vec<u8>, seal: bool) -> Option<Vec<u8>> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: value.len() as u32,
        pbData: value.as_mut_ptr(),
    };
    let entropy = CRYPT_INTEGER_BLOB {
        cbData: binding.len() as u32,
        pbData: binding.as_mut_ptr(),
    };
    let mut result = CRYPT_INTEGER_BLOB::default();
    // DPAPI usa a conta Windows atual. Os buffers de entrada continuam válidos
    // durante a chamada e a saída alocada pela API é sempre liberada com LocalFree.
    let status = unsafe {
        if seal {
            CryptProtectData(&input, PCWSTR::null(), Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut result)
        } else {
            CryptUnprotectData(&input, None, Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut result)
        }
    };
    if result.pbData.is_null() {
        return None;
    }
    unsafe {
        let output = status.ok().map(|_| {
            std::slice::from_raw_parts(result.pbData, result.cbData as usize).to_vec()
        });
        let _ = LocalFree(HLOCAL(result.pbData.cast()));
        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_ciphertext_is_bound_to_the_authentication_scope() {
        let payload = b"example QA session".to_vec();
        let scope = b"persistente:https://test.invalid".to_vec();
        let sealed = transform(payload.clone(), scope.clone(), true).expect("DPAPI seal");
        assert_ne!(sealed, payload);
        assert_eq!(transform(sealed.clone(), scope, false), Some(payload));
        assert!(transform(sealed, b"temporaria:https://other.invalid".to_vec(), false).is_none());
    }
}
