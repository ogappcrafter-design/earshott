package com.outboxenter.earshot;

import android.os.Bundle;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        installCrashRecorder();
        registerPlugin(EarshotPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /** Writes any Java crash to a file so the next launch can report exactly what broke. */
    private void installCrashRecorder() {
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        final File out = new File(getFilesDir(), "last_crash.txt");
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
            try (FileOutputStream fo = new FileOutputStream(out)) {
                StringWriter sw = new StringWriter();
                e.printStackTrace(new PrintWriter(sw));
                fo.write(("thread=" + t.getName() + "\n" + sw).getBytes(StandardCharsets.UTF_8));
            } catch (Exception ignored) {
                Log.e("Earshot", "could not save crash", e);
            }
            if (previous != null) previous.uncaughtException(t, e);
        });
    }

    @Override
    public void onPause() {
        super.onPause();
        // While the background service is running, keep the page's timers and transcription going.
        if (EarshotService.alive && getBridge() != null) {
            WebView w = getBridge().getWebView();
            if (w != null) {
                w.onResume();
                w.resumeTimers();
            }
        }
    }
}
