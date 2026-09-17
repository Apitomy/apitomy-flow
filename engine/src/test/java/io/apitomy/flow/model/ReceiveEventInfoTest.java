package io.apitomy.flow.model;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests the backward-compatible {@link ReceiveEventInfo} constructor: existing callers built
 * before {@code outputMappings} was added must still compile and get an empty list rather than
 * a {@code NoSuchMethodError} or {@code null}.
 */
class ReceiveEventInfoTest {

    @Test
    void legacyFourArgConstructorDefaultsOutputMappingsToEmptyList() {
        ReceiveEventInfo info = new ReceiveEventInfo("r", "Receiver", "order.created", List.of("event.storeId == context.storeId"));

        assertEquals("r", info.nodeId());
        assertEquals("Receiver", info.nodeName());
        assertEquals("order.created", info.eventType());
        assertEquals(List.of("event.storeId == context.storeId"), info.matchExpressions());
        assertNotNull(info.outputMappings());
        assertTrue(info.outputMappings().isEmpty());
    }
}
