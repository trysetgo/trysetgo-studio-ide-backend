{
  "type": "Page",
  "route": "/",
  "layout": "MainLayout",
  "template": "MarketingTemplate",
  "title": "Home",
  "permissions": [],
  "children": [
    {
      "type": "Navbar",
      "name": "MainNavbar",
      "props": {
        "brand": "EcommerceSite"
      },
      "children": []
    },
    {
      "type": "Hero",
      "name": "HomeHero",
      "props": {
        "eyebrow": "TXL Application Architecture V2",
        "title": "Build EcommerceSite as an application graph",
        "subtitle": "Router, layouts, templates, pages, permissions, APIs, workflows, and data models are all defined in TXL."
      },
      "children": []
    },
    {
      "type": "Grid",
      "name": "ArchitectureGrid",
      "children": [
        {
          "type": "Card",
          "name": "RouterCard",
          "props": {
            "title": "Router",
            "body": "Routes resolve pages from the application graph."
          },
          "children": []
        },
        {
          "type": "Card",
          "name": "RuntimeCard",
          "props": {
            "title": "Runtime",
            "body": "TXL compiles into a universal UI tree before rendering."
          },
          "children": []
        }
      ]
    }
  ]
}