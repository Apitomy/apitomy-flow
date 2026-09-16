package io.apitomy.flow.model;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests {@link OutputDefinition#effectiveContextKey()} and the backward-compatible constructors'
 * default {@code contextKey} handling.
 */
class OutputDefinitionTest {

    @Test
    void effectiveContextKeyDefaultsToNameWhenContextKeyOmitted() {
        OutputDefinition def = new OutputDefinition("result", "string", true);
        assertNull(def.contextKey());
        assertEquals("result", def.effectiveContextKey());
    }

    @Test
    void effectiveContextKeyUsesOverrideWhenPresent() {
        OutputDefinition def = new OutputDefinition(
            "result", "string", true, null, null, null, null, null, "orderResult");
        assertEquals("orderResult", def.effectiveContextKey());
    }

    @Test
    void effectiveContextKeyTreatsBlankOverrideAsAbsent() {
        OutputDefinition def = new OutputDefinition(
            "result", "string", true, null, null, null, null, null, "  ");
        assertEquals("result", def.effectiveContextKey());
    }

    @Test
    void fullMetadataConstructorDefaultsContextKeyToNull() {
        OutputDefinition def = new OutputDefinition(
            "decision", "string", true, "Decision", "help", "text", null, null);
        assertNull(def.contextKey());
        assertEquals("decision", def.effectiveContextKey());
    }
}
