package com.dijaedadula.fitdad;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;

/** Test-only screen (not exported): renders the real home-screen widget so CI can screenshot it. */
public class WidgetPreviewActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#3B4252"));
        float d = getResources().getDisplayMetrics().density;
        View w = FitDadWidget.build(this).apply(this, root);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(getResources().getDisplayMetrics().widthPixels - (int) (16 * d), (int) (190 * d), Gravity.CENTER);
        root.addView(w, lp);
        setContentView(root);
    }
}
