package com.insauto.automation;

public enum Platform {
    INSTAGRAM(2200), THREADS(500);

    private final int textLimit;

    Platform(int textLimit) { this.textLimit = textLimit; }

    public int textLimit() { return textLimit; }
}
