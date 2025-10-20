import Component from "./base-component";
import * as Validation from "../util/validation";
import { autobind } from "../decorators/autobind";
import { projectState } from "../state/project-state";

// ProjectInput Class
export class ProjectInput extends Component<HTMLDivElement, HTMLFormElement> {
  titleInputElement: HTMLInputElement;
  descriptionInputElement: HTMLInputElement;
  peopleInputElement: HTMLInputElement;

  constructor() {
    super("project-input", "app", true, "user-input");

    this.titleInputElement = this.element.querySelector(
      "#title"
    ) as HTMLInputElement;
    this.descriptionInputElement = this.element.querySelector(
      "#description"
    ) as HTMLInputElement;
    this.peopleInputElement = this.element.querySelector(
      "#people"
    ) as HTMLInputElement;

    this.configure();
  }

  private gatherUserInput(): [string, string, number] | void {
    const enteredTitle = this.titleInputElement.value;
    const enteredDescription = this.descriptionInputElement.value;
    const enteredPeople = this.peopleInputElement.value;

    const titleValidatable: Validation.Validatable = {
      fieldName: "title",
      value: enteredTitle,
      required: true,
    };

    const descriptionValidatable: Validation.Validatable = {
      fieldName: "description",
      value: enteredDescription,
      required: true,
      minLength: 5,
    };

    const peopleValidatable: Validation.Validatable = {
      fieldName: "people",
      value: +enteredPeople,
      required: true,
      min: 1,
    };

    let errorMessages: string[] = [];

    if (
      !Validation.validate(titleValidatable, errorMessages) ||
      !Validation.validate(descriptionValidatable, errorMessages) ||
      !Validation.validate(peopleValidatable, errorMessages)
    ) {
      const errorMessage = errorMessages.join("\n");
      alert(errorMessage);
      errorMessages = [];
      return;
    } else {
      return [enteredTitle, enteredDescription, +enteredPeople];
    }
  }

  //publicメソッドはprivateメソッドより先に書く
  configure() {
    this.element.addEventListener("submit", this.submitHandler);
  }

  renderContent() {}

  private clearInputs() {
    this.titleInputElement.value = "";
    this.descriptionInputElement.value = "";
    this.peopleInputElement.value = "";
  }

  @autobind
  private submitHandler(event: Event) {
    event.preventDefault();
    const userInput = this.gatherUserInput();

    if (Array.isArray(userInput)) {
      const [title, desc, people] = userInput;
      projectState.addProject(title, desc, people);
      this.clearInputs();
    }
  }
}
