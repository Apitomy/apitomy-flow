package io.apitomy.flow.model;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests parsing and wire round-tripping of {@link EventLookback}.
 */
class EventLookbackTest {

    @Test
    void nullDefaultsToRunStart() {
        assertEquals(EventLookback.RUN_START, EventLookback.parse(null));
    }

    @Test
    void parsesKeywords() {
        assertEquals(EventLookback.Mode.RUN_START, EventLookback.parse("run-start").mode());
        assertEquals(EventLookback.Mode.NONE, EventLookback.parse("none").mode());
        assertNull(EventLookback.parse("none").duration());
    }

    @Test
    void parsesPositiveDuration() {
        EventLookback lookback = EventLookback.parse("PT10M");
        assertEquals(EventLookback.Mode.DURATION, lookback.mode());
        assertEquals(Duration.ofMinutes(10), lookback.duration());
        assertEquals("PT10M", lookback.toWireValue());
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "RUN-START", "forever", "PT0S", "-PT1M", "P1M", "10m"})
    void rejectsInvalidValues(String value) {
        assertThrows(IllegalArgumentException.class, () -> EventLookback.parse(value));
    }

    @Test
    void constructorRejectsInconsistentState() {
        assertThrows(IllegalArgumentException.class, () -> new EventLookback(EventLookback.Mode.DURATION, null));
        assertThrows(IllegalArgumentException.class,
            () -> new EventLookback(EventLookback.Mode.NONE, Duration.ofMinutes(1)));
    }
}
