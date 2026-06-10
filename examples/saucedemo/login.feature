Feature: Sauce Demo login
  The Sauce Labs demo shop at https://www.saucedemo.com

  Scenario: Log in with valid credentials
    Given I am on the login page
    When I log in as "standard_user" with password "secret_sauce"
    Then I should see the products page
    And the page header should contain "Swag Labs"

  Scenario: Log in with a wrong password
    Given I am on the login page
    When I log in as "standard_user" with password "wrong_password"
    Then I should stay on the login page
    And I should see an error message about the username and password not matching

  Scenario: A locked out user cannot log in
    Given I am on the login page
    When I log in as "locked_out_user" with password "secret_sauce"
    Then I should see an error saying the user has been locked out

  Scenario: Logging in and adding an item to the cart
    Given I am logged in as "standard_user" with password "secret_sauce"
    When I add the "Sauce Labs Backpack" to the cart
    Then the cart badge should show "1"
