import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  add,
  multiply,
  findMax,
  createUser,
  delayedGreeting,
  createButton,
  filterTodos,
} from "../src/js/utils.js";

// Exercise 1
describe("utils - Math Functions", () => {
  describe("add", () => {
    it("adds two positive numbers", () => {
      expect(add(2, 3)).toBe(5);
    });

    it("adds a negative and positive number", () => {
      expect(add(-5, 10)).toBe(5);
    });
  });

  describe("multiply", () => {
    it("multiplies two numbers", () => {
      expect(multiply(4, 5)).toBe(20);
    });
  });
});

// Exercise 2
describe("utils - Arrays & Objects", () => {
  describe("findMax", () => {
    it("finds the maximum number in an array", () => {
      expect(findMax([1, 5, 3])).toBe(5);
    });

    it("returns null for empty array", () => {
      expect(findMax([])).toBeNull();
    });

    it("returns null for non-array input", () => {
      expect(findMax("not an array")).toBeNull();
    });
  });

  describe("createUser", () => {
    it("creates a user object with correct properties", () => {
      expect(createUser("John", "Doe")).toEqual({
        firstName: "John",
        lastName: "Doe",
        fullName: "John Doe",
      });
    });

    it("trims whitespace from names", () => {
      const user = createUser("  Jane  ", "  Smith  ");
      expect(user).toEqual({ firstName: "Jane", lastName: "Smith", fullName: "Jane Smith" });
    });
  });
});

// Exercise 3 - timers
describe("utils - Timers", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("calls the callback after the delay", () => {
    const callback = vi.fn();
    delayedGreeting(callback, 1000);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("Hello!");
  });
});

// Exercise 4 - DOM
describe("utils - DOM", () => {
  it("creates a button with text and class, and calls handler on click", () => {
    const onClick = vi.fn();
    const button = createButton("Click me", onClick);

    expect(button.textContent).toBe("Click me");
    expect(button.classList.contains("custom-button")).toBe(true);

    button.dispatchEvent(new Event("click"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

// Exercise 5 - Real feature
describe("utils - filterTodos", () => {
  let sampleTodos;
  beforeEach(() => {
    sampleTodos = [
      { id: "1", text: "Buy milk", done: false },
      { id: "2", text: "Walk dog", done: true },
      { id: "3", text: "Buy groceries", done: false },
      { id: "4", text: "Clean house", done: true },
    ];
  });

  it("returns all todos when status is 'all'", () => {
    expect(filterTodos(sampleTodos, { status: "all" })).toHaveLength(4);
  });

  it("returns only active todos when status is 'active'", () => {
    const result = filterTodos(sampleTodos, { status: "active" });
    expect(result).toHaveLength(2);
    expect(result.every((t) => !t.done)).toBe(true);
  });

  it("returns only completed todos when status is 'done'", () => {
    const result = filterTodos(sampleTodos, { status: "done" });
    expect(result).toHaveLength(2);
    expect(result.every((t) => t.done)).toBe(true);
  });

  it("filters by search term (case-insensitive)", () => {
    const result = filterTodos(sampleTodos, { status: "all", search: "buy" });
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.text)).toEqual(["Buy milk", "Buy groceries"]);
  });

  it("combines status and search filters", () => {
    const result = filterTodos(sampleTodos, { status: "active", search: "buy" });
    expect(result).toHaveLength(2);
    expect(result.every((t) => !t.done)).toBe(true);
  });

  it("returns empty array when no matches", () => {
    const result = filterTodos(sampleTodos, { status: "all", search: "zzz" });
    expect(result).toHaveLength(0);
  });
});
