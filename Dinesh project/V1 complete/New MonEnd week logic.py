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

# Function to extract the last Monday of each month from a date list
def extract_last_week_dates(date_list):
    last_week_dates = []
    current_month = None
    last_monday = None

    for date_str in date_list:
        date_obj = datetime.strptime(date_str, "%Y/%m/%d")
        
        # Check if we are in a new month
        if current_month is None or date_obj.month != current_month:
            # Add the last Monday of the previous month if exists
            if last_monday is not None:
                # Check if the Thursday of the last Monday's week belongs to the same month
                thursday_of_week = last_monday + timedelta(days=3)
                if thursday_of_week.month != last_monday.month:
                    last_monday = last_monday - timedelta(days=7)
                last_week_dates.append(last_monday.strftime("%Y/%m/%d"))

            current_month = date_obj.month
            last_monday = None

        # Update last Monday to current date
        last_monday = date_obj

    # Add the last Monday of the last month if exists
    if last_monday is not None:
        thursday_of_week = last_monday + timedelta(days=3)
        if thursday_of_week.month != last_monday.month:
            last_monday = last_monday - timedelta(days=7)
        last_week_dates.append(last_monday.strftime("%Y/%m/%d"))

    return last_week_dates

date_list = generate_date_range()
last_week_dates = extract_last_week_dates(date_list)

print(last_week_dates)