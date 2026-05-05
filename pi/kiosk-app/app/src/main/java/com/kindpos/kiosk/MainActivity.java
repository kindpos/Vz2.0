package com.kindpos.kiosk;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Toast;

public class MainActivity extends Activity {

    private WebView webView;
    private Handler retryHandler = new Handler();
    private Handler longPressHandler = new Handler();
    private static final int RETRY_DELAY_MS = 5000;
    private static final int LONG_PRESS_MS = 5000;
    private static final String PREFS_NAME = "KINDposPrefs";
    private static final String KEY_URL = "pi_url";
    private static final String KEY_PIN = "settings_pin";
    private static final String DEFAULT_URL = "data:text/html,<html><body style='background:red;color:white'><h1>WebView works</h1></body></html>";
    private static final String DEFAULT_PIN = "1989";

    private boolean longPressTriggered = false;
    private float downX, downY;
    private static final int MOVE_TOLERANCE = 20;

    private final Runnable longPressRunnable = new Runnable() {
        @Override
        public void run() {
            longPressTriggered = true;
            promptPinForSettings();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Enable WebView remote debugging via chrome://inspect
        WebView.setWebContentsDebuggingEnabled(true);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        applyImmersiveMode();
        setContentView(R.layout.activity_main);

        webView = (WebView) findViewById(R.id.webview);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                if (request.isForMainFrame()) {
                    view.loadData(
                            "<html><body style='background:#383c42;color:#e8eaed;" +
                                    "font-family:sans-serif;display:flex;align-items:center;" +
                                    "justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px'>" +
                                    "<h2 style='margin:0'>Connecting to KINDpos...</h2>" +
                                    "<p style='margin:0;color:#7e8896;font-size:14px'>Retrying in 5 seconds</p>" +
                                    "</body></html>",
                            "text/html", "UTF-8"
                    );
                    retryHandler.postDelayed(new Runnable() {
                        @Override
                        public void run() { loadKINDpos(); }
                    }, RETRY_DELAY_MS);
                }
            }
        });

        loadKINDpos();
    }

    @Override
    public boolean dispatchTouchEvent(MotionEvent event) {
        switch (event.getAction()) {
            case MotionEvent.ACTION_DOWN:
                downX = event.getX();
                downY = event.getY();
                longPressTriggered = false;
                longPressHandler.postDelayed(longPressRunnable, LONG_PRESS_MS);
                break;
            case MotionEvent.ACTION_MOVE:
                float dx = Math.abs(event.getX() - downX);
                float dy = Math.abs(event.getY() - downY);
                if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) {
                    longPressHandler.removeCallbacks(longPressRunnable);
                }
                break;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                longPressHandler.removeCallbacks(longPressRunnable);
                break;
        }
        return super.dispatchTouchEvent(event);
    }

    private void promptPinForSettings() {
        final EditText pinInput = new EditText(this);
        pinInput.setInputType(
                android.text.InputType.TYPE_CLASS_NUMBER |
                        android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD
        );
        pinInput.setHint("Settings PIN");

        new AlertDialog.Builder(this)
                .setTitle("Settings")
                .setView(pinInput)
                .setPositiveButton("Enter", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
                        String savedPin = prefs.getString(KEY_PIN, DEFAULT_PIN);
                        if (pinInput.getText().toString().equals(savedPin)) {
                            startActivity(new Intent(MainActivity.this, SettingsActivity.class));
                        }
                    }
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void loadKINDpos() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String url = prefs.getString(KEY_URL, DEFAULT_URL);
        webView.loadUrl(url);
    }

    private void applyImmersiveMode() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
                        View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
                        View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                        View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                        View.SYSTEM_UI_FLAG_FULLSCREEN |
                        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        );
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersiveMode();
    }

    @Override
    public void onBackPressed() { /* Swallow — kiosk mode */ }

    @Override
    protected void onDestroy() {
        retryHandler.removeCallbacksAndMessages(null);
        longPressHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}