
from datetime import datetime, timedelta

def generate_date_range():
    start_date = datetime(2024, 6, 1)  # Starting from June 2024, 1st day
    end_date = datetime(2035, 12, 31)  # Ending on December 2035, last day

    current_date = start_date
    date_list = []

    while current_date <= end_date:
        if current_date.isoweekday() == 1:  # Check if it's a Monday
            date_list.append(current_date.strftime("%Y/%m/%d"))

        current_date += timedelta(days=1)

    return date_list

def extract_last_week_dates(date_list):
    last_week_dates = []
    current_month = None
    last_monday = None

    for date_str in date_list:
        date_obj = datetime.strptime(date_str, "%Y/%m/%d")
        if current_month is None or date_obj.month != current_month:
            if last_monday is not None:
                last_week_dates.append(last_monday.strftime("%Y/%m/%d"))
            current_month = date_obj.month

        last_monday = date_obj

    # Add the last Monday of the last month
    if last_monday is not None:
        last_week_dates.append(last_monday.strftime("%Y/%m/%d"))

    return last_week_dates

date_list = generate_date_range()

print(date_list)

print(extract_last_week_dates(date_list))