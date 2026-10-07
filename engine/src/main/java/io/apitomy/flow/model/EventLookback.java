package io.apitomy.flow.model;

import java.time.Duration;
import java.time.format.DateTimeParseException;
import java.util.Objects;

/**
 * The parsed {@code lookback} setting of a receive-event node. It tells a host how far back to search
 * stored events when a branch parks on the node, so that an event that arrived before the branch parked
 * can still be delivered. Flow itself does not store events; running the look-back is the host's job.
 *
 * @param mode     the look-back mode
 * @param duration the look-back window when {@code mode} is {@link Mode#DURATION}, otherwise {@code null}
 */
public record EventLookback(Mode mode, Duration duration) {

    /** Wire value for {@link Mode#RUN_START}. */
    public static final String RUN_START_VALUE = "run-start";
    /** Wire value for {@link Mode#NONE}. */
    public static final String NONE_VALUE = "none";

    /** The default look-back: events at or after the start of the workflow instance. */
    public static final EventLookback RUN_START = new EventLookback(Mode.RUN_START, null);
    /** No look-back: only events delivered after the node parks. */
    public static final EventLookback NONE = new EventLookback(Mode.NONE, null);

    /** How far back a host should search stored events. */
    public enum Mode {
        /** Events with timestamps at or after the start of the workflow instance. */
        RUN_START,
        /** Only events delivered after the node parks. */
        NONE,
        /** Events newer than now minus {@link EventLookback#duration()}, still limited to the instance start. */
        DURATION
    }

    /**
     * Validates the mode/duration combination.
     *
     * @param mode     the look-back mode
     * @param duration the positive window for {@link Mode#DURATION}, otherwise {@code null}
     */
    public EventLookback {
        Objects.requireNonNull(mode, "mode");
        if (mode == Mode.DURATION) {
            if (duration == null || duration.isZero() || duration.isNegative()) {
                throw new IllegalArgumentException("lookback duration must be positive");
            }
        } else if (duration != null) {
            throw new IllegalArgumentException("lookback duration is only allowed for DURATION mode");
        }
    }

    /**
     * Creates a duration-based look-back.
     *
     * @param duration a positive duration
     * @return the look-back
     */
    public static EventLookback ofDuration(Duration duration) {
        return new EventLookback(Mode.DURATION, duration);
    }

    /**
     * Parses an authored {@code lookback} value. {@code null} yields the default {@link #RUN_START}.
     *
     * @param value {@code run-start}, {@code none}, a positive ISO-8601 duration, or {@code null}
     * @return the parsed look-back
     * @throws IllegalArgumentException if the value is not a valid look-back
     */
    public static EventLookback parse(String value) {
        if (value == null) {
            return RUN_START;
        }
        if (RUN_START_VALUE.equals(value)) {
            return RUN_START;
        }
        if (NONE_VALUE.equals(value)) {
            return NONE;
        }
        Duration duration;
        try {
            duration = Duration.parse(value);
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException("lookback must be \"run-start\", \"none\", or a positive "
                + "ISO-8601 duration: " + value, e);
        }
        if (duration.isZero() || duration.isNegative()) {
            throw new IllegalArgumentException("lookback duration must be positive: " + value);
        }
        return ofDuration(duration);
    }

    /**
     * Returns the wire form of this look-back.
     *
     * @return {@code run-start}, {@code none}, or the ISO-8601 duration text
     */
    public String toWireValue() {
        return switch (mode) {
            case RUN_START -> RUN_START_VALUE;
            case NONE -> NONE_VALUE;
            case DURATION -> duration.toString();
        };
    }
}
