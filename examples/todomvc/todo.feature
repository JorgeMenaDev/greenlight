Feature: TodoMVC
  The Playwright demo TodoMVC app at https://demo.playwright.dev/todomvc

  Scenario: Add a todo
    Given I am on the todo app
    When I add a todo called "buy milk"
    Then I should see "buy milk" in the todo list

  Scenario: Complete a todo
    Given I am on the todo app
    And I have added a todo called "walk the dog"
    When I mark "walk the dog" as completed
    Then the todo "walk the dog" should be shown as completed
    And the "Completed" filter should show "walk the dog"

  Scenario Outline: Adding several todos updates the counter
    Given I am on the todo app
    When I add <count> todos with different names
    Then the items-left counter should show "<label>"

    Examples:
      | count | label        |
      | 1     | 1 item left  |
      | 3     | 3 items left |
