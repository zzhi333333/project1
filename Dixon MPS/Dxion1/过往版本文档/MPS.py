
from collections import defaultdict

# Define Part class
class Part:
    def __init__(self, name, stock):
        self.name = name
        self.stock = stock

# Define BOM structure
class BOM:
    def __init__(self):
        self.structure = defaultdict(list)  # parent -> list of (child, quantity)

    def add_component(self, parent, child, quantity):
        self.structure[parent].append((child, quantity))

# MRP with time buckets
class MRP:
    def __init__(self, bom, parts, weekly_demand):
        self.bom = bom
        self.parts = parts
        self.weekly_demand = weekly_demand
        self.requirements_by_week = defaultdict(lambda: defaultdict(int))
        self.shortages_by_week = defaultdict(lambda: defaultdict(int))

    def calculate_requirements(self):
        for week, demand in self.weekly_demand.items():
            self._calculate_for_item('ProductA', demand, week)

    def _calculate_for_item(self, item, quantity, week):
        if item not in self.bom.structure:
            self.requirements_by_week[week][item] += quantity
            return
        for child, qty_per_unit in self.bom.structure[item]:
            total_qty = quantity * qty_per_unit
            self._calculate_for_item(child, total_qty, week)

    def analyze_shortages(self):
        stock_copy = {name: part.stock for name, part in self.parts.items()}
        for week in sorted(self.weekly_demand.keys()):
            for part, required_qty in self.requirements_by_week[week].items():
                available = stock_copy.get(part, 0)
                if required_qty > available:
                    self.shortages_by_week[week][part] = required_qty - available
                    stock_copy[part] = 0
                else:
                    stock_copy[part] -= required_qty

    def report(self):
        print("Weekly Material Requirements:")
        for week in sorted(self.requirements_by_week.keys()):
            print(f"  Week {week}:")
            for part, qty in self.requirements_by_week[week].items():
                print(f"    {part}: {qty} units required")

        print("\nWeekly Shortages:")
        for week in sorted(self.shortages_by_week.keys()):
            print(f"  Week {week}:")
            for part, shortage in self.shortages_by_week[week].items():
                print(f"    {part}: {shortage} units short")

# Define parts and BOH stock
parts = {
    'Part1': Part('Part1', 50),
    'Part2': Part('Part2', 10),
    'Part3': Part('Part3', 5)
}

# Define BOM structure
bom = BOM()
bom.add_component('ProductA', 'Part1', 2)
bom.add_component('ProductA', 'Part2', 3)
bom.add_component('Part2', 'Part3', 2)

# Define weekly demand for ProductA
weekly_demand = {
    1: 10,
    2: 5,
    3: 8
}

# Run MRP simulation
mrp = MRP(bom, parts, weekly_demand)
mrp.calculate_requirements()
mrp.analyze_shortages()
mrp.report()

