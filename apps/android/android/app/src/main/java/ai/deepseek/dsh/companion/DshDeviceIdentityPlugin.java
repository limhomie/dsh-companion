package ai.deepseek.dsh.companion;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;

@CapacitorPlugin(name = "DshDeviceIdentity")
public final class DshDeviceIdentityPlugin extends Plugin {
    private static final String KEY_ALIAS = "dsh-companion-device-v1";
    private static final String PREFERENCES = "dsh-companion-connection";

    @PluginMethod
    public void getIdentity(PluginCall call) {
        try {
            KeyPair keyPair = getOrCreateKeyPair();
            JSObject result = new JSObject();
            result.put("publicKey", encode(keyPair.getPublic().getEncoded()));
            result.put("label", Build.MANUFACTURER + " " + Build.MODEL);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法创建 Android Keystore 设备身份", "KEYSTORE_FAILURE", error);
        }
    }

    @PluginMethod
    public void sign(PluginCall call) {
        String message = call.getString("message");
        if (message == null || message.isEmpty()) {
            call.reject("缺少待签名消息", "INVALID_MESSAGE");
            return;
        }
        try {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            PrivateKey privateKey = (PrivateKey) keyStore.getKey(KEY_ALIAS, null);
            if (privateKey == null) {
                call.reject("Android Keystore 设备身份不存在", "KEY_NOT_FOUND");
                return;
            }
            Signature signer = Signature.getInstance("SHA256withECDSA");
            signer.initSign(privateKey);
            signer.update(message.getBytes(StandardCharsets.UTF_8));
            JSObject result = new JSObject();
            result.put("signature", encode(signer.sign()));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Android Keystore 签名失败", "SIGNATURE_FAILURE", error);
        }
    }

    @PluginMethod
    public void loadConnection(PluginCall call) {
        SharedPreferences preferences = preferences();
        String origin = preferences.getString("origin", null);
        String deviceId = preferences.getString("deviceId", null);
        String label = preferences.getString("label", null);
        JSObject result = new JSObject();
        result.put("configured", origin != null && deviceId != null && label != null);
        if (origin != null) result.put("origin", origin);
        if (deviceId != null) result.put("deviceId", deviceId);
        if (label != null) result.put("label", label);
        call.resolve(result);
    }

    @PluginMethod
    public void saveConnection(PluginCall call) {
        String origin = call.getString("origin");
        String deviceId = call.getString("deviceId");
        String label = call.getString("label");
        if (origin == null || deviceId == null || label == null) {
            call.reject("连接信息不完整", "INVALID_CONNECTION");
            return;
        }
        preferences().edit()
            .putString("origin", origin)
            .putString("deviceId", deviceId)
            .putString("label", label)
            .apply();
        call.resolve();
    }

    @PluginMethod
    public void reset(PluginCall call) {
        try {
            preferences().edit().clear().apply();
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS);
            call.resolve();
        } catch (Exception error) {
            call.reject("无法重置 Android 设备身份", "RESET_FAILURE", error);
        }
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    private KeyPair getOrCreateKeyPair() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        KeyStore.Entry existing = keyStore.getEntry(KEY_ALIAS, null);
        if (existing instanceof KeyStore.PrivateKeyEntry) {
            KeyStore.PrivateKeyEntry entry = (KeyStore.PrivateKeyEntry) existing;
            return new KeyPair(entry.getCertificate().getPublicKey(), entry.getPrivateKey());
        }
        KeyPairGenerator generator = KeyPairGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_EC,
            "AndroidKeyStore"
        );
        generator.initialize(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY
        )
            .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(false)
            .build());
        return generator.generateKeyPair();
    }

    private static String encode(byte[] value) {
        return Base64.encodeToString(value, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }
}
