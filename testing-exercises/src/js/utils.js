/**
 * @fileoverview Utility functions for testing practice.
 */

export const add = (a, b) => a + b;
export const multiply = (a, b) => a * b;

export const findMax = (numbers) => {
  if (!Array.isArray(numbers) || numbers.length === 0) return null;
  return Math.max(...numbers);
};

export const createUser = (firstName, lastName) => {
  return {
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    fullName: `${firstName.trim()} ${lastName.trim()}`,
  };
};

export const delayedGreeting = (callback, delay) => {
  setTimeout(() => {
    callback("Hello!");
  }, delay);
};

export const createButton = (text, onClick) => {
  const button = document.createElement("button");
  button.textContent = text;
  button.className = "custom-button";
  button.addEventListener("click", onClick);
  return button;
};

export const filterTodos = (todos, { status, search = "" }) => {
  let filtered = todos;
  if (status === "active") filtered = filtered.filter((t) => !t.done);
  else if (status === "done") filtered = filtered.filter((t) => t.done);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter((t) => (t.text ?? "").toLowerCase().includes(q));
  }
  return filtered;
};
