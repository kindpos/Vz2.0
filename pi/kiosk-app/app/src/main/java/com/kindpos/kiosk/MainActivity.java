package com.kindpos.kiosk;

import android.app.Activity;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.view.GestureDetector;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.content.Intent;

public class MainActivity extends Activity {

    private WebView webView;
    private Handler retryHandler = new Handler();
    private static final int RETRY_DELAY_MS = 5000;
    private static final String PREFS_NAME = "KINDposPrefs";
    private static final String KEY_URL = "pi_url";
    private static final String DEFAULT_URL = "http://192.168.50.1:8000/terminal/";
    private GestureDetector gestureDetector;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Keep screen on always
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Full immersive mode
        applyImmersiveMode();

        setContentView(R.layout.activity_main);
        webView = (WebView) findViewById(R.id.webview);

        // WebView settings
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        // Handle errors with retry
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                         WebResourceError error) {
                if (request.isForMainFrame()) {
                    view.loadData(
                        "<html><body style='background:#383c42;color:#e8eaed;" +
                        "font-family:sans-serif;display:flex;align-items:center;" +
                        "justify-content:center;height:100vh;margin:0;'>" +
                        "<h2>Connecting to KINDpos...</h2></body></html>",
                        "text/html", "UTF-8"
                    );
                    retryHandler.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            loadKINDpos();
                        }
                    }, RETRY_DELAY_MS);
                }
            }
        });

        // Long press detector for secret settings (5 seconds)
        gestureDetector = new GestureDetector(this,
            new GestureDetector.SimpleOnGestureListener() {
                @Override
                public void onLongPress(MotionEvent e) {
                    startActivity(new Intent(MainActivity.this, SettingsActivity.class));
                }
            }
        );

        loadKINDpos();
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
    public void onBackPressed() {
        // Swallow back button — kiosk mode
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        gestureDetector.onTouchEvent(event);
        return super.onTouchEvent(event);
    }

    @Override
    protected void onDestroy() {
        retryHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
